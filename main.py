from dis import disco
import os
from typing import Optional

# The decky plugin module is located at decky-loader/plugin
# For easy intellisense checkout the decky-loader code repo
# and add the `decky-loader/plugin/imports` path to `python.analysis.extraPaths` in `.vscode/settings.json`
import decky
import asyncio
import json


class Plugin:
    # A normal method. It can be called from the TypeScript side using @decky/api.
    async def add(self, left: int, right: int) -> int:
        return left + right

    # Asyncio-compatible long-running code, executed in a task when the plugin is loaded
    async def _main(self):
        self.settings_path = os.path.join(
            decky.DECKY_PLUGIN_SETTINGS_DIR, "settings.json")
        self.settings = self._load_setting()
        self.wsdd_path = os.path.join(
            decky.DECKY_PLUGIN_DIR, "py_modules", "wsdd.py")
        self._installing = False
        decky.logger.info("main loaded")

    # Function called first during the unload process, utilize this to handle your plugin being stopped, but not
    # completely removed
    async def _unload(self):
        decky.logger.info("Goodnight World!")
        pass

    # Function called after `_unload` during uninstall, utilize this to clean up processes and other remnants of your
    # plugin that may remain on the system
    async def _uninstall(self):
        decky.logger.info("Goodbye World!")
        pass

    async def _run(self, cmd: str) -> tuple[int, str, str]:
        process = await asyncio.create_subprocess_shell(
            cmd,
            env=self._clean_env(),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        stdout, stderr = await process.communicate()
        assert process.returncode is not None
        return process.returncode, stdout.decode().strip(), stderr.decode().strip()

    async def get_smb_status(self) -> dict:
        # get ip
        rcode_ip, ip_out, _ = await self._run("ip route get 1 | awk '{print $7; exit}'")
        decky.logger.info(
            f"IP cmd: rcode={rcode_ip}, stdout='{ip_out}'")
        if rcode_ip == 0:
            ip = ip_out
        else:
            ip = ""

        smb_active = False
        installed = False
        discovery = {}

        rcode_ins, _, _ = await self._run("which smbd")
        if rcode_ins == 0:
            installed = True
        if installed:
            # check smb active
            _, stdout, _ = await self._run("systemctl is-active smb")
            smb_active = stdout == "active"
            # check wsdd and avahi
            _, out_wsdd, _ = await self._run("systemctl is-active wsdd")
            discovery["wsdd"] = out_wsdd == "active"
            _, out_avahi, _ = await self._run("systemctl is-active avahi-daemon")
            discovery["avahi"] = out_avahi == "active"

        return {
            "installed": installed,
            "active": smb_active,
            "ip": ip,
            "netbios_name": self.settings.get("netbios_name", "steamdeck"),
            "discovery": discovery
        }

    async def install_smb(self) -> dict:
        if self._installing:
            return {"success": False, "error": "Installation already in progress"}
        self._installing = True
        steps = []
        try:
            await decky.emit("install_progress", "Disabling read-only filesystem...")
            rc, stdout, stderr = await self._run("steamos-readonly disable")
            decky.logger.info(
                f"steamos-readonly disable: rc={rc} stdout={stdout} stderr={stderr}")
            if rc != 0:
                return {"success": False, "error": f"Failed to disable read-only: {stdout or stderr}"}
            steps.append("readonly_disabled")

            await decky.emit("install_progress", "Configuring pacman...")
            await self._run(r"sed -i '/^SigLevel[[:space:]]*=[[:space:]]*Required DatabaseOptional/s/^/#/' /etc/pacman.conf")
            await self._run(r"sed -i '/^#SigLevel[[:space:]]*=[[:space:]]*Required DatabaseOptional/a\SigLevel = TrustAll' /etc/pacman.conf")
            await self._run("pacman-key --init")
            await self._run("pacman-key --populate archlinux")

            # smb install
            await decky.emit("install_progress", "Installing samba package...")
            await self._run("rm -f /usr/lib/holo/pacmandb/db.lck /var/lib/pacman/db.lck")
            _, readonly_out, _ = await self._run("btrfs property get / ro")
            decky.logger.info(f"btrfs check read only: {readonly_out}")
            if "ro=true" in readonly_out:
                await self._run("btrfs property set / ro false")
                await self._run("mount -o remount,rw /")
            rc, stdout, stderr = await self._run("pacman -Sy --noconfirm samba")
            decky.logger.info(
                f"pacman install samba: rc={rc} stderr={stderr[:200] if stderr else ''}")
            if rc != 0:
                return {"success": False, "error": f"Failed to install samba: {stderr}"}
            steps.append("samba_installed")

            # default password
            await decky.emit("install_progress", "Setting defualt password...")
            process = await asyncio.create_subprocess_exec(
                "smbpasswd", "-a", "-s", "deck",
                env=self._clean_env(),
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            await process.communicate(input=b"0000\n0000\n")
            steps.append("password_set")

            await decky.emit("install_progress", "Configuring samba...")
            if not self.settings.get("shares"):
                self.settings["shares"] = [
                    {"name": "home", "path": "/home/deck", "enabled": True}
                ]
                self._save_setting()
            await self._write_smb_conf()
            steps.append("conf_written")

            await decky.emit("install_progress", "Configuring firewall...")
            await self._run("firewall-cmd --zone=public --add-service=samba --permanent")
            await self._run("firewall-cmd --zone=public --add-service=mdns --permanent")
            await self._run("firewall-cmd --zone=public --add-port=3702/udp --permanent")
            await self._run("firewall-cmd --reload")
            steps.append("firewall_configured")

            await decky.emit("install_progress", "Configuring network discovery...")
            await self._setup_discovery()
            steps.append("discovery_configured")

            await decky.emit("install_progress", "Starting services...")
            await self._run("systemctl enable smb")
            await self._run("systemctl start smb")
            if os.path.exists("/etc/systemd/system/wsdd.service"):
                await self._run("systemctl enable wsdd")
                await self._run("systemctl start wsdd")

            await self._run("systemctl enable avahi-daemon")
            await self._run("systemctl start avahi-daemon")
            steps.append("services_started")

            await decky.emit("install_progress", "Installation complete!")
            decky.logger.info("smb install complete")
            return {"success": True, "steps": steps}

        except Exception as e:
            decky.logger.error(f"Install failed: {e}")
            return {"success": False, "error": str(e)}
        finally:
            self._installing = False
            if "readonly_disabled" in steps:
                await self._run("steamos-readonly enable")

    async def uninstall_samba(self) -> dict:
        try:
            for service in ["smb", "wsdd", "avahi-daemon", "avahi-daemon.socket"]:
                await self._run(f"systemctl stop {service}")
                await self._run(f"systemctl disable {service}")

            rc, _, stderr = await self._run("steamos-readonly disable")
            if rc != 0:
                return {"success": False, "error": f"Failed to disable read only: {stderr}"}
            try:
                await self._run("rm -f /usr/lib/holo/pacmandb/db.lck /var/lib/pacman/db.lck")
                await self._run("pacman -Rns --noconfirm samba")
            finally:
                await self._run("steamos-readonly enable")

            self._remove_file("/etc/samba/smb.conf")
            self._remove_file("/etc/avahi/services/smb.service")
            self._remove_file("/etc/systemd/system/wsdd.service")

            await self._run("systemctl daemon-reload")

            return {"success": True}
        except Exception as e:
            decky.logger.error(f"Uninstall failed: {e}")
            return {"success": False, "error": str(e)}

    async def toggle_smb(self, enable: bool) -> dict:
        if enable:
            action = "start"
            boot_action = "enable"
        else:
            action = "stop"
            boot_action = "disable"

        rc, _, stderr = await self._run(f"systemctl {action} smb")
        if rc != 0:
            return {"success": False, "error": stderr}

        await self._run(f"systemctl {boot_action} smb")
        await self._run(f"systemctl {action} wsdd")
        await self._run(f"systemctl {boot_action} wsdd")

        if enable:
            await self._write_avahi_service()
            await self._run("systemctl enable avahi-daemon")
            await self._run("systemctl start avahi-daemon")
        else:
            await self._remove_avahi_service()
            for svc in ["avahi-daemon", "avahi-daemon.socket"]:
                await self._run(f"systemctl stop {svc}")
                await self._run(f"systemctl disable {svc}")
        return {"success": True}

    async def list_dirs(self, path: str) -> dict:
        try:
            folder_list = []
            for folder in os.scandir(path):
                if not folder.is_dir():
                    continue
                if folder.name.startswith("."):
                    continue
                folder_list.append(folder.name)
            folder_list.sort()
            return {"success": True, "path": path, "dirs": folder_list}

        except PermissionError:
            return {"success": False, "error": "Permission denied"}
        except FileNotFoundError:
            return {"success": False, "error": "Path not found"}

    async def get_shares(self) -> list:
        return self.settings.get("shares", [])

    async def add_share(self, name: str, path: str) -> dict:
        path = os.path.realpath(path)

        shares = self.settings.get("shares", [])
        for s in shares:
            if s["name"] == name:
                return {"success": False, "error": f"Share '{name}' already exists"}

        shares.append({"name": name, "path": path, "enabled": True})
        self.settings["shares"] = shares
        self._save_setting()
        await self._write_smb_conf()
        await self._run("systemctl reload-or-restart smb")
        decky.logger.info("smb restarted because of add share")
        return {"success": True}

    async def remove_share(self, name: str) -> dict:

        shares = self.settings.get("shares", [])
        for s in shares:
            if s["name"] == name:
                shares.remove(s)
                decky.logger.info("share removed")
                break

        self.settings["shares"] = shares
        self._save_setting()
        await self._write_smb_conf()
        await self._run("systemctl reload-or-restart smb")
        decky.logger.info("smb restarted because of remove share")
        return {"success": True}

    # config write

    async def _remove_avahi_service(self):
        self._remove_file("/etc/avahi/services/smb.service")

    async def _write_smb_conf(self):
        netbios = self.settings.get("netbios_name", "steamdeck")
        shares = self.settings.get("shares", [])

        lines = [
            "[global]",
            f" netbios name = {netbios}",
            ""
        ]

        for share in shares:
            if not share.get("enabled", True):
                continue
            lines.extend([
                f"[{share['name']}]",
                f"  comment = {share['name']} directory",
                f"  path = {share['path']}",
                "   browseable = yes",
                "   read only = no",
                "   create mask = 0777",
                "   directory mask = 0777",
                "   force user = deck",
                "   force group = deck",
                "",
            ])
        self._write_file("/etc/samba/smb.conf", "\n".join(lines))

    async def _install_wsdd(self):
        netbios = self.settings.get("netbios_name", "steamdeck")
        service = (
            "[Unit]\n"
            "Description=Web Services Dynamic Discovery host daemon\n"
            "After=network-online.target smb.service\n"
            "Wants=network-online.target\n"
            "\n"
            "[Service]\n"
            "Type=simple\n"
            f"ExecStart=/usr/bin/python3 {self.wsdd_path} --shortlog -n {netbios}\n"
            "Restart=on-failure\n"
            "RestartSec=5\n"
            "\n"
            "[Install]\n"
            "WantedBy=multi-user.target\n"
        )
        self._write_file("/etc/systemd/system/wsdd.service", service)

        await self._run("systemctl daemon-reload")
        return True

    async def _write_avahi_service(self):

        content = (
            '<?xml version="1.0" standalone=\'no\'?>\n'
            '<!DOCTYPE service-group SYSTEM "avahi-service.dtd">\n'
            "<service-group>\n"
            '  <name replace-wildcards="yes">%h</name>\n'
            "  <service>\n"
            "    <type>_smb._tcp</type>\n"
            "    <port>445</port>\n"
            "  </service>\n"
            "</service-group>\n"
        )
        self._write_file("/etc/avahi/services/smb.service", content)

    # helpers

    @staticmethod
    def _clean_env() -> dict:
        """
        clean LD_LIBRARY_PATH before run cmd, otherwise wrong realine will be loaded
        """
        env = os.environ.copy()
        env.pop("LD_LIBRARY_PATH", None)
        env.pop("LD_PRELOAD", None)
        return env

    def _write_file(self, path: str, content: str):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as f:
            f.write(content)

    def _remove_file(self, path: str):
        if os.path.exists(path):
            os.remove(path)

    def _load_setting(self) -> dict:
        if os.path.exists(self.settings_path):
            with open(self.settings_path, "r") as f:
                return json.load(f)
        defaults_path = os.path.join(decky.DECKY_PLUGIN_DIR, "settings.json")
        if os.path.exists(defaults_path):
            with open(defaults_path, "r") as f:
                return json.load(f)

        decky.logger.warning("No settings found, writing new settings")
        settings = {"shares": [
            {
                "name": "home",
                "path": "/home/deck",
                "enabled": True
            }
        ], "netbios_name": "steamdeck"}
        self._save_setting(settings)
        return settings

    def _save_setting(self, settings: Optional[dict] = None):

        if settings is not None:
            self.settings = settings
        os.makedirs(os.path.dirname(self.settings_path), exist_ok=True)
        with open(self.settings_path, "w") as f:
            json.dump(self.settings, f, indent=2)

    async def _setup_discovery(self):

        await self._write_avahi_service()
        await self._install_wsdd()
