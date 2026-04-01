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
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        stdout, stderr = await process.communicate()
        assert process.returncode is not None
        return process.returncode, stdout.decode(), stderr.decode()

    # helpers

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
