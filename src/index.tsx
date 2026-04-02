import {
  ButtonItem,
  PanelSection,
  PanelSectionRow,
  ToggleField,
  Field,
  Focusable,
  DialogButton,
  ModalRoot,
  showModal,
  staticClasses,
} from "@decky/ui";
import {
  addEventListener,
  removeEventListener,
  callable,
  definePlugin,
} from "@decky/api";
import { useState, useEffect, Fragment, FC } from "react";
import { FaNetworkWired, FaTrash, FaPlus } from "react-icons/fa";

interface DiscoveryStatus {
  avahi: boolean;
  wsdd: boolean;
}

interface SambaStatus {
  installed: boolean;
  active: boolean;
  ip: string;
  netbios_name: string;
  discovery: DiscoveryStatus;
}

interface Share {
  name: string;
  path: string;
  enabled: boolean;
}

interface Result {
  success: boolean;
  error?: string;
  [key: string]: unknown;
}

const getSambaStatus = callable<[], SambaStatus>("get_smb_status");
const installSamba = callable<[], Result>("install_smb");
const uninstallSamba = callable<[], Result>("uninstall_samba");
const toggleSamba = callable<[boolean], Result>("toggle_smb");
const listDirs = callable<[string], { success: boolean; path: string; dirs: string[]; error?: string }>("list_dirs");
const getShares = callable<[], Share[]>("get_shares");
const addShare = callable<[string, string], Result>("add_share");
const removeShare = callable<[string], Result>("remove_share");

const InstallPanel: FC<{ onInstalled: () => void }> = ({ onInstalled }) => {
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const listener = addEventListener<[string]>("install_progress", (msg) => {
      setProgress(msg);
    });
    return () => { removeEventListener("install_progress", listener); };
  }, []);

  const handleInstall = async () => {
    setInstalling(true);
    setError("");
    try {
      const result = await installSamba();
      if (result.success) {
        onInstalled();
      } else {
        setError(result.error || "Installation failed");
      }
    } catch (e) {
      setError(String(e));
    }
    setInstalling(false);
  };

  return (
    <PanelSection title="Install Samba">
      <PanelSectionRow>
        <Field label="Status">
          Samba is not installed
        </Field>
      </PanelSectionRow>
      <PanelSectionRow>
        <ButtonItem
          layout="below"
          onClick={handleInstall}
          disabled={installing}
        >
          {installing ? progress || "Installing..." : "Install Samba"}
        </ButtonItem>
      </PanelSectionRow>
      {error && (
        <PanelSectionRow>
          <Field label="Error">{error}</Field>
        </PanelSectionRow>
      )}
      <PanelSectionRow>
        <div style={{ fontSize: "11px", opacity: 0.8, padding: "0 16px", marginTop: "8px" }}>
          Note: SteamOS updates will remove Samba due to its immutable filesystem. You will need to reinstall after each system update. Your shares and password will be preserved.
        </div>
      </PanelSectionRow>
    </PanelSection>
  );
};


const FolderBrowserModal: FC<{
  closeModal?: () => void;
  onSelect: (path: string) => void;
}> = ({ closeModal, onSelect }) => {
  const [currentPath, setCurrentPath] = useState("/home/deck");
  const [dirs, setDirs] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const browse = async (path: string) => {
    setLoading(true);
    const result = await listDirs(path);
    if (result.success) {
      setCurrentPath(result.path);
      setDirs(result.dirs);
    }
    setLoading(false);
  };

  useEffect(() => {
    browse(currentPath);
  }, []);

  const goUp = () => {
    const parent = currentPath.replace(/\/[^/]+\/?$/, "") || "/";
    browse(parent);
  };

  return (
    <ModalRoot closeModal={closeModal}>
      <div style={{ padding: "16px", maxHeight: "400px", display: "flex", flexDirection: "column" }}>
        <h3 style={{ marginBottom: "8px" }}>Select Folder</h3>
        <div style={{ marginBottom: "8px", fontSize: "12px", opacity: 0.7, wordBreak: "break-all" }}>
          {currentPath}
        </div>
        <div style={{ flex: 1, overflowY: "auto", marginBottom: "12px" }}>
          {loading ? (
            <div>Loading...</div>
          ) : (
            <Focusable>
              <DialogButton onClick={goUp} style={{ marginBottom: "4px", padding: "8px" }}>
                ..
              </DialogButton>
              {dirs.map((dir) => (
                <DialogButton
                  key={dir}
                  onClick={() => browse(currentPath === "/" ? `/${dir}` : `${currentPath}/${dir}`)}
                  style={{ marginBottom: "4px", padding: "8px", textAlign: "left" }}
                >
                  {dir}
                </DialogButton>
              ))}
              {dirs.length === 0 && <div style={{ opacity: 0.5, padding: "8px" }}>No subfolders</div>}
            </Focusable>
          )}
        </div>
        <Focusable>
          <DialogButton onClick={() => { onSelect(currentPath); closeModal?.(); }} style={{ marginBottom: "8px" }}>
            Share This Folder
          </DialogButton>
          <DialogButton onClick={() => closeModal?.()}>
            Cancel
          </DialogButton>
        </Focusable>
      </div>
    </ModalRoot>
  );
};


const ShareListPanel: FC<{ shares: Share[]; onRefresh: () => void }> = ({ shares, onRefresh }) => {
  const handleRemove = async (name: string) => {
    await removeShare(name);
    onRefresh();
  };

  if (shares.length === 0) {
    return (
      <PanelSection title="Shared Folders">
        <PanelSectionRow>
          <Field label="No shares configured">Add a share below</Field>
        </PanelSectionRow>
      </PanelSection>
    );
  }

  return (
    <PanelSection title="Shared Folders">
      {shares.map((share) => (
        <Fragment key={share.name}>
          <PanelSectionRow>
            <Field label={share.name} description={share.path} />
          </PanelSectionRow>
          <PanelSectionRow>
            <ButtonItem layout="below" onClick={() => handleRemove(share.name)}>
              <FaTrash /> Remove "{share.name}"
            </ButtonItem>
          </PanelSectionRow>
        </Fragment>
      ))}
    </PanelSection>
  );
};

const AddSharePanel: FC<{ onAdded: () => void }> = ({ onAdded }) => {
  const doAddShare = async (path: string) => {
    const name = path.replace(/\/+$/, "").split("/").pop() || path;
    await addShare(name, path);
    onAdded();
  };

  const handleBrowse = () => {
    showModal(<FolderBrowserModal onSelect={doAddShare} />);
  };

  return (
    <PanelSection title="Add Share">
      <PanelSectionRow>
        <ButtonItem layout="below" onClick={handleBrowse}>
          <FaPlus /> Browse Folders
        </ButtonItem>
      </PanelSectionRow>
    </PanelSection>
  );
};

const Content: FC = () => {
  const [status, setStatus] = useState<SambaStatus | null>(null);
  const [shares, setShares] = useState<Share[]>([]);
  const [loading, setLoading] = useState(true);
  const [uninstalling, setUninstalling] = useState(false);
  const [toggling, setToggling] = useState(false);

  const refresh = async () => {
    try {
      const [s, sh] = await Promise.all([getSambaStatus(), getShares()]);
      setStatus(s);
      setShares(sh);
    } catch (e) {
      console.error("Failed to get status:", e);
    }
    setLoading(false);
  };

  useEffect(() => {
    refresh();
  }, []);

  if (loading) {
    return (
      <PanelSection title="Samba Server">
        <PanelSectionRow>
          <Field label="Loading...">Please wait</Field>
        </PanelSectionRow>
      </PanelSection>
    );
  }

  if (!status?.installed && !uninstalling) {
    return <InstallPanel onInstalled={refresh} />;
  }

  if (uninstalling) {
    return (
      <PanelSection title="Uninstalling Samba">
        <PanelSectionRow>
          <Field label="Status">Removing and cleaning...</Field>
        </PanelSectionRow>
      </PanelSection>
    );
  }

  const handleUninstall = async () => {
    setUninstalling(true);
    await uninstallSamba();
    setUninstalling(false);
    await refresh();
  };

  return (
    <Fragment>
      <PanelSection title="Samba Server">
        <PanelSectionRow>
          <ToggleField
            label="SMB Service"
            description={toggling ? (status!.active ? "Stopping..." : "Starting...") : (status!.active ? "Running" : "Stopped")}
            checked={status!.active}
            disabled={toggling}
            onChange={async (val: boolean) => {
              setToggling(true);
              await toggleSamba(val);
              await refresh();
              setToggling(false);
            }}
          />
        </PanelSectionRow>
        <PanelSectionRow>
          <ButtonItem layout="below" onClick={handleUninstall}>
            Uninstall Samba
          </ButtonItem>
        </PanelSectionRow>
      </PanelSection>

      <ShareListPanel shares={shares} onRefresh={refresh} />
      <AddSharePanel onAdded={refresh} />
    </Fragment>
  );
};

export default definePlugin(() => ({
  name: "DeckSMB",
  titleView: <div className={staticClasses.Title}>DeckSMB</div>,
  content: <Content />,
  icon: <FaNetworkWired />,
  onDismount() {},
}));
