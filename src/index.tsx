import {
  ButtonItem,
  PanelSection,
  PanelSectionRow,
  Field,
  staticClasses,
} from "@decky/ui";
import {
  addEventListener,
  callable,
  definePlugin,
} from "@decky/api";
import { useState, useEffect, Fragment, FC } from "react";
import { FaNetworkWired } from "react-icons/fa";

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

interface Result {
  success: boolean;
  error?: string;
  [key: string]: unknown;
}

const getSambaStatus = callable<[], SambaStatus>("get_smb_status");
const installSamba = callable<[], Result>("install_smb");

const InstallPanel: FC<{ onInstalled: () => void }> = ({ onInstalled }) => {
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const unsub = addEventListener<[string]>("install_progress", (msg) => {
      setProgress(msg);
    });
    return () => { unsub; };
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


const Content: FC = () => {
  const [status, setStatus] = useState<SambaStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    try {
      const s = await getSambaStatus();
      setStatus(s);
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

  if (!status?.installed) {
    return <InstallPanel onInstalled={refresh} />;
  }

  return (
    <Fragment>
      <PanelSection title="Samba Server">
        <PanelSectionRow>
          <Field label="SMB Service">
            {status.active ? "Running" : "Stopped"}
          </Field>
        </PanelSectionRow>
      </PanelSection>
    </Fragment>
  );
};

export default definePlugin(() => ({
  name: "Samba Server",
  titleView: <div className={staticClasses.Title}>Samba Server</div>,
  content: <Content />,
  icon: <FaNetworkWired />,
  onDismount() {},
}));
