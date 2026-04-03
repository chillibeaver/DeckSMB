import {
  ButtonItem,
  PanelSection,
  PanelSectionRow,
  ToggleField,
  TextField,
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
import { FaNetworkWired, FaTrash, FaPlus, FaKey } from "react-icons/fa";
import { t, loadTranslations } from "./i18n/translations";

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
const toggleShare = callable<[string, boolean], Result>("toggle_share");
const setSambaPassword = callable<[string], Result>("set_smb_password");
const checkAndRepair = callable<[], Result>("check_and_repair");

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
        setError(result.error || t("install.installFailed"));
      }
    } catch (e) {
      setError(String(e));
    }
    setInstalling(false);
  };

  return (
    <PanelSection title={t("install.title")}>
      <PanelSectionRow>
        <Field label={t("install.status")}>
          {t("install.notInstalled")}
        </Field>
      </PanelSectionRow>
      <PanelSectionRow>
        <ButtonItem
          layout="below"
          onClick={handleInstall}
          disabled={installing}
        >
          {installing ? progress || t("install.installing") : t("install.installButton")}
        </ButtonItem>
      </PanelSectionRow>
      {error && (
        <PanelSectionRow>
          <Field label={t("install.error")}>{error}</Field>
        </PanelSectionRow>
      )}
      <PanelSectionRow>
        <div style={{ fontSize: "11px", opacity: 0.8, padding: "0 16px", marginTop: "8px" }}>
          {t("install.note")}
        </div>
      </PanelSectionRow>
    </PanelSection>
  );
};


const TextInputModal: FC<{
  closeModal?: () => void;
  title: string;
  label: string;
  description?: string;
  initialValue?: string;
  bIsPassword?: boolean;
  onSubmit: (value: string) => Promise<string | void>;
}> = ({ closeModal, title, label, description, initialValue = "", bIsPassword = false, onSubmit }) => {
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState("");
  const handleOK = async () => {
    setError("");
    const err = await onSubmit(value);
    if (err) {
      setError(err);
    } else {
      closeModal?.();
    }
  };
  return (
    <ModalRoot closeModal={closeModal}>
      <div style={{ padding: "16px" }}>
        <h3 style={{ marginBottom: "12px" }}>{title}</h3>
        <TextField
          label={label}
          description={description}
          bIsPassword={bIsPassword}
          value={value}
          onChange={(e: any) => setValue(e?.target?.value ?? "")}
        />
        {error && (
          <div style={{ color: "#f44", marginTop: "8px", fontSize: "13px" }}>{error}</div>
        )}
        <Focusable style={{ marginTop: "16px" }}>
          <DialogButton onClick={handleOK} style={{ marginBottom: "8px" }}>
            {t("modal.ok")}
          </DialogButton>
          <DialogButton onClick={() => closeModal?.()}>
            {t("modal.cancel")}
          </DialogButton>
        </Focusable>
      </div>
    </ModalRoot>
  );
};

const FolderBrowserModal: FC<{
  closeModal?: () => void;
  onSelect: (path: string) => Promise<Result>;
}> = ({ closeModal, onSelect }) => {
  const [currentPath, setCurrentPath] = useState("/home/deck");
  const [dirs, setDirs] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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
        <h3 style={{ marginBottom: "8px" }}>{t("folderBrowser.title")}</h3>
        <div style={{ marginBottom: "8px", fontSize: "12px", opacity: 0.7, wordBreak: "break-all" }}>
          {currentPath}
        </div>
        <div style={{ flex: 1, overflowY: "auto", marginBottom: "12px" }}>
          {loading ? (
            <div>{t("folderBrowser.loading")}</div>
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
              {dirs.length === 0 && <div style={{ opacity: 0.5, padding: "8px" }}>{t("folderBrowser.noSubfolders")}</div>}
            </Focusable>
          )}
        </div>
        {error && (
          <div style={{ color: "#f44", fontSize: "13px", marginBottom: "8px" }}>{error}</div>
        )}
        <Focusable>
          <DialogButton onClick={async () => {
            setError("");
            const result = await onSelect(currentPath);
            if (result.success) {
              closeModal?.();
            } else {
              setError(t("folderBrowser.shareAlreadyExists"));
            }
          }} style={{ marginBottom: "8px" }}>
            {t("folderBrowser.shareThisFolder")}
          </DialogButton>
          <DialogButton onClick={() => closeModal?.()}>
            {t("modal.cancel")}
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

  const handleToggle = async (name: string, enabled: boolean) => {
    await toggleShare(name, enabled);
    onRefresh();
  };

  if (shares.length === 0) {
    return (
      <PanelSection title={t("shares.title")}>
        <PanelSectionRow>
          <Field label={t("shares.noShares")}>{}</Field>
        </PanelSectionRow>
      </PanelSection>
    );
  }

  return (
    <PanelSection title={t("shares.title")}>
      {shares.map((share) => (
        <Fragment key={share.name}>
          <PanelSectionRow>
            <ToggleField
              label={share.name}
              description={share.path}
              checked={share.enabled}
              onChange={(val: boolean) => handleToggle(share.name, val)}
            />
          </PanelSectionRow>
          <PanelSectionRow>
            <ButtonItem layout="below" onClick={() => handleRemove(share.name)}>
              <FaTrash /> {t("shares.remove", { name: share.name })}
            </ButtonItem>
          </PanelSectionRow>
        </Fragment>
      ))}
    </PanelSection>
  );
};

const AddSharePanel: FC<{ onAdded: () => void }> = ({ onAdded }) => {
  const doAddShare = async (path: string): Promise<Result> => {
    const name = path.replace(/\/+$/, "").split("/").pop() || path;
    const result = await addShare(name, path);
    if (result.success) onAdded();
    return result;
  };

  const handleBrowse = () => {
    showModal(<FolderBrowserModal onSelect={doAddShare} />);
  };

  return (
      <PanelSectionRow>
        <ButtonItem layout="below" onClick={handleBrowse}>
          <FaPlus /> {t("server.addFolders")}
        </ButtonItem>
      </PanelSectionRow>
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
    checkAndRepair();
  }, []);

  if (loading) {
    return (
      <PanelSection title={t("server.title")}>
        <PanelSectionRow>
          <Field label={t("server.loading")}>{t("server.pleaseWait")}</Field>
        </PanelSectionRow>
      </PanelSection>
    );
  }

  if (!status?.installed && !uninstalling) {
    return <InstallPanel onInstalled={refresh} />;
  }

  if (uninstalling) {
    return (
      <PanelSection title={t("uninstall.title")}>
        <PanelSectionRow>
          <Field label={t("uninstall.status")}>{t("uninstall.removing")}</Field>
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
      <PanelSection title={t("server.title")}>
        <PanelSectionRow>
          <ToggleField
            label={t("server.smbService")}
            description={toggling ? (status!.active ? t("server.stopping") : t("server.starting")) : (status!.active ? t("server.running") : t("server.stopped"))}
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
        <AddSharePanel onAdded={refresh} />
        <PanelSectionRow>
          <ButtonItem layout="below" onClick={() => showModal(
            <TextInputModal
              title={t("server.changePasswordTitle")}
              label={t("server.newPassword")}
              bIsPassword={true}
              onSubmit={async (val) => {
                if (!val) return t("server.passwordEmpty");
                const result = await setSambaPassword(val);
                if (result.success) return;
                return result.error || t("server.passwordFailed");
              }}
            />
          )}>
            <FaKey /> {t("server.changePassword")}
          </ButtonItem>
        </PanelSectionRow>
        <style>{`.decksmb-danger .DialogButton { color: #f44 !important; }`}</style>
        <div className="decksmb-danger">
          <PanelSectionRow>
            <ButtonItem layout="below" onClick={handleUninstall}>
              <FaTrash /> {t("server.uninstallSamba")}
            </ButtonItem>
          </PanelSectionRow>
        </div>
      </PanelSection>
      <ShareListPanel shares={shares} onRefresh={refresh} />
    </Fragment>
  );
};

export default definePlugin(() => {
  loadTranslations();
  return {
  name: "DeckSMB",
  titleView: <div className={staticClasses.Title}>DeckSMB</div>,
  content: <Content />,
  icon: <FaNetworkWired />,
  onDismount() {},
  };
});
