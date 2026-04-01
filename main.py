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
            rc, stdout, stderr = await self._run("pacman -Sy --nonconfirm samba")
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

            await decky.emit("install_progress", "Starting services...")
            await self._run("systemctl enable smb")
            await self._run("systemctl start smb")

            await self._run("systemctl enable avahi-daemon")
            await self._run("systemctl start avahi-daemon")
            steps.append("services_started")

            await decky.emit("install_progress", "Installation complete!")
            return {"success": True, "steps": steps}

        except Exception as e:
            decky.logger.error(f"Install failed: {e}")
            return {"success": False, "error": str(e)}
        finally:
            self._installing = False
            if "readonly_disabled" in steps:
                await self._run("steamos-readonly enable")

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
