#!/usr/bin/env bash

# ==============================================================================
# Aura Minecraft Server Setup WebUI - Guided Linux Installer
# Supported OS: Ubuntu, Debian, CentOS, RHEL, Rocky Linux, AlmaLinux
# ==============================================================================

# Ensure script is run as root
if [ "$EUID" -ne 0 ]; then
  echo -e "\e[31mError: This script must be run as root (using sudo).\e[0m"
  exit 1
fi

set -e

# Visual colors
RED='\e[31m'
GREEN='\e[32m'
YELLOW='\e[33m'
BLUE='\e[34m'
CYAN='\e[36m'
BOLD='\e[1m'
NC='\e[0m' # No Color

# ==============================================================================
# Parse Command Line Arguments/Flags
# ==============================================================================
MODE_REPAIR=false
MODE_REPAIR_CLI=false
MODE_UNINSTALL=false
MODE_DAEMON_ONLY=false

while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --fix|--repair)
      MODE_REPAIR=true
      shift
      ;;
    --fix-cli|--repair-cli)
      MODE_REPAIR_CLI=true
      shift
      ;;
    --uninstall)
      MODE_UNINSTALL=true
      shift
      ;;
    --daemon-only)
      MODE_DAEMON_ONLY=true
      shift
      ;;
    -h|--help)
      echo -e "${BOLD}${CYAN}==========================================================${NC}"
      echo -e "${BOLD}    Aura Guided Linux Installer Options${NC}"
      echo -e "${BOLD}${CYAN}==========================================================${NC}"
      echo -e "  ${YELLOW}--fix, --repair${NC}       Repair/refresh an existing installation with current configurations."
      echo -e "  ${YELLOW}--fix-cli, --repair-cli${NC}   Repair/refresh only the global 'aura' CLI administration helper."
      echo -e "  ${YELLOW}--uninstall${NC}           Safely remove Aura Panel, Daemon, and service configurations."
      echo -e "  ${YELLOW}--daemon-only${NC}         Install only the Daemon component for headless remote nodes."
      echo -e "  ${YELLOW}-h, --help${NC}            Show this help information."
      echo -e "${BOLD}${CYAN}==========================================================${NC}"
      exit 0
      ;;
    *)
      echo -e "${RED}Error: Unknown option '$1'${NC}"
      echo "Use -h or --help to see available options."
      exit 1
      ;;
  esac
done

echo -e "${BOLD}${CYAN}"
echo "=========================================================="
echo "    Aura Platform Guided Linux Installer"
echo "=========================================================="
echo -e "${NC}"

# Helper function to read input safely, redirecting from /dev/tty if stdin is piped
prompt_user() {
  local prompt_text="$1"
  local default_val="$2"
  local var_name="$3"
  local input_val
  
  if [ -t 0 ]; then
    read -rp "$prompt_text" input_val
  elif [ -c /dev/tty ]; then
    read -rp "$prompt_text" input_val < /dev/tty
  else
    input_val=""
  fi
  
  # Indirect variable assignment with default fallback
  eval "$var_name=\"\${input_val:-\$default_val}\""
}

# Auto-detect existing Aura installation if in repair mode
if [ "$MODE_REPAIR" = true ] || [ "$MODE_REPAIR_CLI" = true ]; then
  echo -e "${BLUE}* Auto-detecting existing Aura installation...${NC}"
  
  # Resolve AURA_ROOT from symlink target first
  if [ -L "/usr/local/bin/aura" ]; then
    AURA_LINK_TARGET=$(readlink -f /usr/local/bin/aura)
    AURA_ROOT=$(dirname "$AURA_LINK_TARGET")
  fi
  
  # Fallback to checking default directory
  if [ -z "$AURA_ROOT" ] || [ ! -d "$AURA_ROOT" ]; then
    AURA_ROOT="/opt/aura"
  fi
  
  if [ -d "$AURA_ROOT" ]; then
    echo -e "${GREEN}✔ Detected installation root: $AURA_ROOT${NC}"
  else
    if [ "$MODE_REPAIR_CLI" = true ]; then
      echo -e "${YELLOW}⚠ Could not find existing installation directory. Defaulting root to /opt/aura.${NC}"
      AURA_ROOT="/opt/aura"
    else
      echo -e "${RED}Error: No existing Aura installation found to repair at $AURA_ROOT.${NC}"
      echo "Please run a fresh guided installation by executing the script without flags."
      exit 1
    fi
  fi
fi

# Targeted repair logic for 'aura' CLI individually
if [ "$MODE_REPAIR_CLI" = true ]; then
  echo -e "\n${BLUE}* Repairing global 'aura' CLI Helper tool...${NC}"
  
  REPO_URL="https://github.com/4ngel2769/aura-panel.git"
  TEMP_REPO="/tmp/aura-panel-repo"
  
  # Resolve sources
  if [ -d "./panel" ] && [ -d "./daemon" ] && [ -d "./frontend" ]; then
    echo -e "${GREEN}✔ Running inside the deployment source tree. Copying files directly...${NC}"
    SRC_DIR="$(pwd)"
  else
    echo -e "${BLUE}* Cloning latest codebase from GitHub...${NC}"
    rm -rf "$TEMP_REPO"
    git clone "$REPO_URL" "$TEMP_REPO"
    SRC_DIR="$TEMP_REPO"
  fi
  
  # Ensure AURA_ROOT directory exists
  mkdir -p "$AURA_ROOT"
  
  # Deploy CLI
  cp "$SRC_DIR/aura-cli.js" "$AURA_ROOT/aura-cli.js"
  chmod +x "$AURA_ROOT/aura-cli.js"
  ln -sf "$AURA_ROOT/aura-cli.js" /usr/local/bin/aura
  
  # Cleanup if temp repo was cloned
  if [ -d "$TEMP_REPO" ]; then
    rm -rf "$TEMP_REPO"
  fi
  
  echo -e "\n${GREEN}${BOLD}=========================================================="
  echo "    Aura CLI Repair Completed Successfully!"
  echo -e "==========================================================${NC}"
  echo -e "  - Global 'aura' command linked to /usr/local/bin/aura"
  echo -e "  - Corrected file located at $AURA_ROOT/aura-cli.js"
  echo "=========================================================="
  exit 0
fi

# ==============================================================================
# Uninstall Mode
# ==============================================================================
if [ "$MODE_UNINSTALL" = true ]; then
  echo -e "\n${BOLD}${RED}==========================================================${NC}"
  echo -e "${BOLD}    Aura Platform Uninstaller${NC}"
  echo -e "${BOLD}${RED}==========================================================${NC}\n"

  # Auto-detect AURA_ROOT from symlink if not already set
  if [ -z "$AURA_ROOT" ]; then
    if [ -L "/usr/local/bin/aura" ]; then
      AURA_LINK_TARGET=$(readlink -f /usr/local/bin/aura)
      AURA_ROOT=$(dirname "$AURA_LINK_TARGET")
    fi
  fi

  if [ -z "$AURA_ROOT" ] || [ ! -d "$AURA_ROOT" ]; then
    AURA_ROOT="/opt/aura"
  fi

  echo -e "${BLUE}Detected installation root: ${CYAN}$AURA_ROOT${NC}"
  echo ""

  # Detect what's installed
  HAS_PANEL=false
  HAS_DAEMON=false
  [ -d "$AURA_ROOT/panel" ] || [ -f /etc/systemd/system/aura-panel.service ] && HAS_PANEL=true
  [ -d "$AURA_ROOT/daemon" ] || [ -f /etc/systemd/system/aura-daemon.service ] && HAS_DAEMON=true

  echo -e "${BOLD}Detected components:${NC}"
  [ "$HAS_PANEL" = true ] && echo -e "  - ${CYAN}Aura Panel${NC}"
  [ "$HAS_DAEMON" = true ] && echo -e "  - ${CYAN}Aura Daemon${NC}"
  [ -L "/usr/local/bin/aura" ] && echo -e "  - ${CYAN}Aura CLI (/usr/local/bin/aura)${NC}"
  echo ""

  # Confirmation
  echo -e "${YELLOW}${BOLD}WARNING: This will stop all Aura services and remove code files.${NC}"
  echo -e "${YELLOW}Database files, daemon keys, and server data will be preserved by default.${NC}"
  prompt_user "Are you sure you want to uninstall? (yes/no) [Default: no]: " "no" "CONFIRM_UNINSTALL"

  if [ "$CONFIRM_UNINSTALL" != "yes" ] && [ "$CONFIRM_UNINSTALL" != "y" ]; then
    echo -e "${GREEN}Uninstallation cancelled.${NC}"
    exit 0
  fi

  echo ""

  # Step 1: Stop and disable systemd services
  if command -v systemctl &> /dev/null; then
    if [ "$HAS_PANEL" = true ] && [ -f /etc/systemd/system/aura-panel.service ]; then
      echo -e "${BLUE}* Stopping aura-panel service...${NC}"
      systemctl stop aura-panel 2>/dev/null || true
      systemctl disable aura-panel 2>/dev/null || true
      rm -f /etc/systemd/system/aura-panel.service
      echo -e "${GREEN}✔ aura-panel service stopped and removed.${NC}"
    fi

    if [ "$HAS_DAEMON" = true ] && [ -f /etc/systemd/system/aura-daemon.service ]; then
      echo -e "${BLUE}* Stopping aura-daemon service...${NC}"
      systemctl stop aura-daemon 2>/dev/null || true
      systemctl disable aura-daemon 2>/dev/null || true
      rm -f /etc/systemd/system/aura-daemon.service
      echo -e "${GREEN}✔ aura-daemon service stopped and removed.${NC}"
    fi

    systemctl daemon-reload 2>/dev/null || true
  fi

  # Step 2: Remove code files, preserve data
  if [ "$HAS_PANEL" = true ] && [ -d "$AURA_ROOT/panel" ]; then
    echo -e "${BLUE}* Removing Panel code files (preserving database)...${NC}"
    # Preserve panel database
    PANEL_DB="$AURA_ROOT/panel/data/db.json"
    PANEL_DB_BACKUP=""
    if [ -f "$PANEL_DB" ]; then
      PANEL_DB_BACKUP="/tmp/aura-panel-db-backup.json"
      cp "$PANEL_DB" "$PANEL_DB_BACKUP"
      echo -e "  ${GREEN}✔ Panel database backed up to $PANEL_DB_BACKUP${NC}"
    fi
    rm -rf "$AURA_ROOT/panel"
    echo -e "${GREEN}✔ Panel code removed.${NC}"
  fi

  if [ "$HAS_DAEMON" = true ] && [ -d "$AURA_ROOT/daemon" ]; then
    echo -e "${BLUE}* Removing Daemon code files (preserving config & key)...${NC}"
    # Preserve daemon config (contains the key)
    DAEMON_CFG="$AURA_ROOT/daemon/config.json"
    DAEMON_DB="$AURA_ROOT/daemon/data/db.json"
    DAEMON_CFG_BACKUP=""
    DAEMON_DB_BACKUP=""
    if [ -f "$DAEMON_CFG" ]; then
      DAEMON_CFG_BACKUP="/tmp/aura-daemon-config-backup.json"
      cp "$DAEMON_CFG" "$DAEMON_CFG_BACKUP"
      echo -e "  ${GREEN}✔ Daemon config (with key) backed up to $DAEMON_CFG_BACKUP${NC}"
    fi
    if [ -f "$DAEMON_DB" ]; then
      DAEMON_DB_BACKUP="/tmp/aura-daemon-db-backup.json"
      cp "$DAEMON_DB" "$DAEMON_DB_BACKUP"
      echo -e "  ${GREEN}✔ Daemon database backed up to $DAEMON_DB_BACKUP${NC}"
    fi
    rm -rf "$AURA_ROOT/daemon"
    echo -e "${GREEN}✔ Daemon code removed.${NC}"
  fi

  # Step 3: Remove CLI
  if [ -f "$AURA_ROOT/aura-cli.js" ]; then
    rm -f "$AURA_ROOT/aura-cli.js"
    echo -e "${GREEN}✔ CLI file removed from $AURA_ROOT${NC}"
  fi
  if [ -L "/usr/local/bin/aura" ]; then
    rm -f /usr/local/bin/aura
    echo -e "${GREEN}✔ Global 'aura' symlink removed.${NC}"
  fi

  echo ""

  # Step 4: Ask about full data removal
  echo -e "${YELLOW}${BOLD}Do you also want to remove ALL remaining data?${NC}"
  echo -e "${YELLOW}This includes: database backups in $AURA_ROOT, the aura system user, and server files in /home/aura/servers.${NC}"
  prompt_user "Remove all data? (yes/no) [Default: no]: " "no" "REMOVE_DATA"

  if [ "$REMOVE_DATA" = "yes" ] || [ "$REMOVE_DATA" = "y" ]; then
    echo -e "${RED}* Removing all Aura data...${NC}"
    rm -rf "$AURA_ROOT"
    rm -rf /home/aura/servers
    # Remove system user
    if id -u aura &>/dev/null; then
      userdel -r aura 2>/dev/null || userdel aura 2>/dev/null || true
      echo -e "${GREEN}✔ System user 'aura' removed.${NC}"
    fi
    # Clean backups from /tmp
    rm -f /tmp/aura-panel-db-backup.json /tmp/aura-daemon-config-backup.json /tmp/aura-daemon-db-backup.json
    echo -e "${GREEN}✔ All data removed.${NC}"
  else
    echo -e "${CYAN}Data preserved. Backup locations:${NC}"
    [ -n "$PANEL_DB_BACKUP" ] && echo -e "  - Panel DB:      $PANEL_DB_BACKUP"
    [ -n "$DAEMON_CFG_BACKUP" ] && echo -e "  - Daemon Config: $DAEMON_CFG_BACKUP"
    [ -n "$DAEMON_DB_BACKUP" ] && echo -e "  - Daemon DB:     $DAEMON_DB_BACKUP"
    [ -d /home/aura/servers ] && echo -e "  - Server files:  /home/aura/servers (untouched)"
    echo -e "\n${CYAN}You can reinstall Aura and your data will be restored automatically.${NC}"
  fi

  echo -e "\n${GREEN}${BOLD}==========================================================${NC}"
  echo -e "${GREEN}${BOLD}    Aura Platform Uninstalled Successfully.${NC}"
  echo -e "${GREEN}${BOLD}==========================================================${NC}"
  exit 0
fi

# Detect configuration settings if in full repair mode
if [ "$MODE_REPAIR" = true ]; then
  echo -e "\n${BLUE}* Loading existing configurations for repair...${NC}"
  
  # 1. Detect if panel is installed
  HAS_PANEL=false
  if [ -d "$AURA_ROOT/panel" ] || [ -f /etc/systemd/system/aura-panel.service ]; then
    HAS_PANEL=true
  fi
  
  # 2. Detect if daemon is installed
  HAS_DAEMON=false
  if [ -d "$AURA_ROOT/daemon" ] || [ -f /etc/systemd/system/aura-daemon.service ]; then
    HAS_DAEMON=true
  fi
  
  # Determine INSTALL_MODE based on what we found
  if [ "$HAS_PANEL" = true ] && [ "$HAS_DAEMON" = true ]; then
    INSTALL_MODE=1
    echo -e "  - Mode detected: ${CYAN}Central Panel & Local Daemon (Full Setup)${NC}"
  elif [ "$HAS_PANEL" = true ]; then
    INSTALL_MODE=2
    echo -e "  - Mode detected: ${CYAN}Central Panel Only (Controller Node)${NC}"
  elif [ "$HAS_DAEMON" = true ]; then
    INSTALL_MODE=3
    echo -e "  - Mode detected: ${CYAN}Daemon Only (Runner Agent Node)${NC}"
  else
    echo -e "${RED}Error: Could not determine existing installation components.${NC}"
    exit 1
  fi
  
  # 3. Extract Panel Port
  PANEL_PORT="3000"
  if [ -f /etc/systemd/system/aura-panel.service ]; then
    DETECTED_PORT=$(grep -oP 'Environment=PORT=\K[0-9]+' /etc/systemd/system/aura-panel.service || true)
    if [ -n "$DETECTED_PORT" ]; then
      PANEL_PORT="$DETECTED_PORT"
      echo -e "  - Detected Panel Port: ${CYAN}$PANEL_PORT${NC}"
    fi
  fi
  
  # 4. Extract Daemon Port & Bind Address
  DAEMON_PORT="21013"
  DAEMON_BIND="0.0.0.0"
  if [ -f "$AURA_ROOT/daemon/config.json" ]; then
    # Use grep to extract values from JSON (more reliable than require in mixed module contexts)
    DETECTED_DPORT=$(grep -oP '"port":\s*\K[0-9]+' "$AURA_ROOT/daemon/config.json" || true)
    DETECTED_DBIND=$(grep -oP '"address":\s*"\K[^"]+' "$AURA_ROOT/daemon/config.json" || true)
    if [ -n "$DETECTED_DPORT" ]; then
      DAEMON_PORT="$DETECTED_DPORT"
      echo -e "  - Detected Daemon Port: ${CYAN}$DAEMON_PORT${NC}"
    fi
    if [ -n "$DETECTED_DBIND" ]; then
      DAEMON_BIND="$DETECTED_DBIND"
      echo -e "  - Detected Daemon Bind Address: ${CYAN}$DAEMON_BIND${NC}"
    fi
  fi
fi

# 1. Directory prompt first (so we can detect existing installations)
if [ "$MODE_REPAIR" = false ]; then
  prompt_user "Enter installation root directory [Default: /opt/aura]: " "/opt/aura" "AURA_ROOT"

  # Check for existing installation and offer options
  if [ -d "$AURA_ROOT" ] && [ "$(ls -A "$AURA_ROOT" 2>/dev/null)" ]; then
    echo -e "\n${YELLOW}${BOLD}⚠ Existing Aura installation detected at $AURA_ROOT${NC}"
    
    HAS_PANEL=false
    HAS_DAEMON=false
    [ -d "$AURA_ROOT/panel" ] || [ -f /etc/systemd/system/aura-panel.service ] && HAS_PANEL=true
    [ -d "$AURA_ROOT/daemon" ] || [ -f /etc/systemd/system/aura-daemon.service ] && HAS_DAEMON=true
    
    echo -e "${CYAN}Detected components:${NC}"
    [ "$HAS_PANEL" = true ] && echo -e "  - Aura Panel"
    [ "$HAS_DAEMON" = true ] && echo -e "  - Aura Daemon"
    
    echo ""
    echo -e "${BOLD}What would you like to do?${NC}"
    echo "  1) Use --fix flag to repair/update the existing installation (recommended)"
    echo "  2) Continue with fresh install (will overwrite configuration)"
    echo "  3) Cancel and exit"
    
    prompt_user "Enter choice (1-3): " "1" "EXISTING_CHOICE"
    
    case "$EXISTING_CHOICE" in
      1)
        echo -e "\n${BLUE}Run the following to repair your installation:${NC}"
        echo -e "  ${CYAN}sudo bash aura-install.sh --fix${NC}\n"
        exit 0
        ;;
      3)
        echo -e "${YELLOW}Installation cancelled.${NC}"
        exit 0
        ;;
      2)
        echo -e "${YELLOW}Proceeding with fresh install (existing configuration will be overwritten).${NC}"
        ;;
      *)
        echo -e "${RED}Invalid choice. Exiting.${NC}"
        exit 1
        ;;
    esac
  fi

  # 2. Ask what to install
  if [ "$MODE_DAEMON_ONLY" = true ]; then
    INSTALL_MODE=3
    echo -e "${CYAN}Daemon-only mode selected via flag.${NC}"
  else
    echo -e "${BOLD}Select Installation Mode:${NC}"
    echo "  1) Central Panel & Local Daemon (Full Setup) [Default]"
    echo "  2) Central Panel Only (Controller Node)"
    echo "  3) Daemon Only (Runner Agent Node)"
    prompt_user "Enter choice (1-3) [Default: 1]: " "1" "INSTALL_MODE"
  fi

  # 3. Ports prompts
  if [ "$INSTALL_MODE" -eq 1 ] || [ "$INSTALL_MODE" -eq 2 ]; then
    prompt_user "Enter AuraPanel Web Port [Default: 3000]: " "3000" "PANEL_PORT"
  fi

  if [ "$INSTALL_MODE" -eq 1 ] || [ "$INSTALL_MODE" -eq 3 ]; then
    prompt_user "Enter AuraDaemon Listen Port [Default: 21013]: " "21013" "DAEMON_PORT"
    prompt_user "Enter AuraDaemon Bind Address [Default: 0.0.0.0]: " "0.0.0.0" "DAEMON_BIND"
  fi
fi

echo -e "\n${BLUE}* Verifying system dependencies...${NC}"

# 4. Dependency Installation
install_node_with_nvm() {
  echo -e "${YELLOW}Installing isolated Node.js/npm using NVM (Node Version Manager) in /opt/nvm...${NC}"
  export NVM_DIR="/opt/nvm"
  mkdir -p "$NVM_DIR"
  
  # Ensure curl is installed to pull NVM
  if ! command -v curl &> /dev/null; then
    if [ -f /etc/debian_version ]; then
      apt-get update -y && apt-get install -y curl build-essential
    else
      yum install -y curl gcc-c++ make
    fi
  fi
  
  # Run NVM installer targeting /opt/nvm
  curl -sL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.4/install.sh | bash
  
  # Source NVM to load it in this session
  [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
  
  if ! command -v nvm &> /dev/null; then
    echo -e "${RED}Error: NVM installation failed.${NC}"
    exit 1
  fi
  
  echo -e "${BLUE}* Installing Node.js LTS v20...${NC}"
  nvm install 20
  nvm use 20
  
  # Expose node and npm globally to /usr/local/bin so any user can access them
  local node_bin=$(which node)
  ln -sf "$node_bin" /usr/local/bin/node
  
  local npm_bin="$NVM_DIR/versions/node/$(nvm current)/bin/npm"
  if [ -f "$npm_bin" ]; then
    ln -sf "$npm_bin" /usr/local/bin/npm
  else
    ln -sf "$(which npm)" /usr/local/bin/npm
  fi
  
  # Set execute permissions on NVM tree so unprivileged users like 'aura' can run Node
  chmod -R +rX "$NVM_DIR"
  
  echo -e "${GREEN}✔ Node.js $(node -v) and npm $(npm -v) successfully set up via NVM.${NC}"
}

# Verify Node.js and npm availability for root
export NVM_DIR="/opt/nvm"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  \. "$NVM_DIR/nvm.sh"
fi

if ! command -v node &> /dev/null || ! command -v npm &> /dev/null; then
  install_node_with_nvm
else
  NODE_VER=$(node -v | cut -d'v' -f2 | cut -d'.' -f1 || echo 0)
  if [ "$NODE_VER" -lt 18 ]; then
    echo -e "${YELLOW}Detected outdated Node.js ($NODE_VER). Upgrading with NVM...${NC}"
    install_node_with_nvm
  else
    echo -e "${GREEN}✔ Node.js $(node -v) is already installed.${NC}"
    # Ensure a global symlink exists for npm if it works but lacks global path bindings
    if ! command -v npm &> /dev/null; then
      install_node_with_nvm
    fi
  fi
fi

# Ensure git is installed
if ! command -v git &> /dev/null; then
  echo -e "${YELLOW}Installing Git...${NC}"
  if [ -f /etc/debian_version ]; then
    apt-get install -y git
  else
    yum install -y git
  fi
fi

# Ensure unzip is installed
if ! command -v unzip &> /dev/null; then
  echo -e "${YELLOW}Installing Unzip...${NC}"
  if [ -f /etc/debian_version ]; then
    apt-get install -y unzip
  else
    yum install -y unzip
  fi
fi

# 5. Fetch code repository
REPO_URL="https://github.com/4ngel2769/aura-panel.git"
TEMP_REPO="/tmp/aura-panel-repo"

# Resolve sources
if [ -d "./panel" ] && [ -d "./daemon" ] && [ -d "./frontend" ]; then
  echo -e "${GREEN}✔ Running inside the deployment source tree. Copying files directly...${NC}"
  SRC_DIR="$(pwd)"
else
  echo -e "${BLUE}* Cloning codebase from GitHub repository...${NC}"
  rm -rf "$TEMP_REPO"
  git clone "$REPO_URL" "$TEMP_REPO"
  SRC_DIR="$TEMP_REPO"
fi

# 6. Create directories and secure users
mkdir -p "$AURA_ROOT"
id -u aura &>/dev/null || useradd -r -m -s /bin/false aura

# 7. Install selected modules
if [ "$INSTALL_MODE" -eq 1 ] || [ "$INSTALL_MODE" -eq 2 ]; then
  echo -e "\n${BLUE}* Deploying Aura Central Panel...${NC}"
  mkdir -p "$AURA_ROOT/panel"
  cp -R "$SRC_DIR/panel/"* "$AURA_ROOT/panel/"
  
  # Build frontend static files
  echo -e "${BLUE}* Compiling React frontend dashboard...${NC}"
  cd "$SRC_DIR/frontend"
  npm install
  npm run build
  
  # Deploy static frontend
  mkdir -p "$AURA_ROOT/panel/public"
  cp -R "$SRC_DIR/frontend/dist/"* "$AURA_ROOT/panel/public/"
  
  # Install panel dependencies
  echo -e "${BLUE}* Installing Panel backend dependencies...${NC}"
  cd "$AURA_ROOT/panel"
  npm install --omit=dev
  
  chown -R aura:aura "$AURA_ROOT/panel"
  echo -e "${GREEN}✔ AuraPanel successfully deployed to $AURA_ROOT/panel${NC}"
fi

if [ "$INSTALL_MODE" -eq 1 ] || [ "$INSTALL_MODE" -eq 3 ]; then
  echo -e "\n${BLUE}* Deploying Aura Daemon...${NC}"
  mkdir -p "$AURA_ROOT/daemon"
  cp -R "$SRC_DIR/daemon/"* "$AURA_ROOT/daemon/"
  
  # Write configurations
  echo -e "${BLUE}* Configuring Daemon bind values...${NC}"
  cat <<EOF > "$AURA_ROOT/daemon/config.json"
{
  "name": "AuraNode-Primary",
  "address": "${DAEMON_BIND}",
  "port": ${DAEMON_PORT}
}
EOF

  # Install daemon dependencies
  echo -e "${BLUE}* Installing Daemon dependencies...${NC}"
  cd "$AURA_ROOT/daemon"
  npm install --omit=dev
  
  # Create server container folders
  mkdir -p /home/aura/servers
  chown -R root:root "$AURA_ROOT/daemon"
  chown -R aura:aura /home/aura/servers
  echo -e "${GREEN}✔ AuraDaemon successfully deployed to $AURA_ROOT/daemon${NC}"
fi

# 8. Install CLI Utility
echo -e "\n${BLUE}* Installing global 'aura' CLI Helper tool...${NC}"
cp "$SRC_DIR/aura-cli.js" "$AURA_ROOT/aura-cli.js"
chmod +x "$AURA_ROOT/aura-cli.js"
ln -sf "$AURA_ROOT/aura-cli.js" /usr/local/bin/aura
echo -e "${GREEN}✔ Global 'aura' command linked to /usr/local/bin/aura${NC}"

# 9. Register Systemd Services
NODE_BIN=$(which node)

if [ "$INSTALL_MODE" -eq 1 ] || [ "$INSTALL_MODE" -eq 2 ]; then
  echo -e "${BLUE}* Registering systemd service: aura-panel.service...${NC}"
  cat <<EOF > /etc/systemd/system/aura-panel.service
[Unit]
Description=Aura Minecraft Control Panel
After=network.target

[Service]
Type=simple
User=aura
WorkingDirectory=${AURA_ROOT}/panel
Environment=PORT=${PANEL_PORT}
ExecStart=${NODE_BIN} src/server.js
Restart=always
RestartSec=10
StandardOutput=syslog
StandardError=syslog
SyslogIdentifier=aura-panel

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable aura-panel
  systemctl start aura-panel
fi

if [ "$INSTALL_MODE" -eq 1 ] || [ "$INSTALL_MODE" -eq 3 ]; then
  echo -e "${BLUE}* Registering systemd service: aura-daemon.service...${NC}"
  cat <<EOF > /etc/systemd/system/aura-daemon.service
[Unit]
Description=Aura Minecraft Daemon Agent
After=network.target docker.service

[Service]
Type=simple
User=root
WorkingDirectory=${AURA_ROOT}/daemon
ExecStart=${NODE_BIN} src/server.js
Restart=always
RestartSec=10
StandardOutput=syslog
StandardError=syslog
SyslogIdentifier=aura-daemon

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable aura-daemon
  systemctl start aura-daemon
fi

# Cleanup
if [ -d "$TEMP_REPO" ]; then
  rm -rf "$TEMP_REPO"
fi

echo -e "\n${GREEN}${BOLD}=========================================================="
echo "    Aura Installation Completed Successfully!"
echo -e "==========================================================${NC}"

if [ "$INSTALL_MODE" -eq 1 ] || [ "$INSTALL_MODE" -eq 2 ]; then
  echo -e "  - AuraPanel is running on: ${CYAN}http://localhost:${PANEL_PORT}${NC}"
fi

if [ "$INSTALL_MODE" -eq 1 ] || [ "$INSTALL_MODE" -eq 3 ]; then
  echo -e "  - AuraDaemon is listening on: ${CYAN}${DAEMON_BIND}:${DAEMON_PORT}${NC}"
  
  # Extract first key
  sleep 1.5
  DAEMON_KEY=$(grep -oP '"key":\s*"\K[^"]+' "$AURA_ROOT/daemon/config.json" || true)
  if [ -z "$DAEMON_KEY" ] || [ "$DAEMON_KEY" = "undefined" ]; then
    echo -e "${YELLOW}Note: Daemon key will be generated on first service start.${NC}"
  fi
  
  if [ -n "$DAEMON_KEY" ] && [ "$DAEMON_KEY" != "undefined" ]; then
    echo -e "  - Secure Daemon Key: ${GREEN}${DAEMON_KEY}${NC}"
  else
    echo -e "  - Secure Daemon Key: (will be generated on first daemon startup)"
  fi
fi

echo -e "\n${BOLD}Useful Administration Commands:${NC}"
echo -e "  - Check system status:     ${YELLOW}aura status${NC}"
echo -e "  - Check nodes status:      ${YELLOW}aura nodes ls${NC}"
echo -e "  - Check server instances:  ${YELLOW}aura instances ls${NC}"
echo -e "  - Open server console:     ${YELLOW}aura instance <instance-id> console${NC}"
echo -e "  - Check environment health: ${YELLOW}aura healthchecks${NC}"
echo "=========================================================="
