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

# 1. Ask what to install
echo -e "${BOLD}Select Installation Mode:${NC}"
echo "  1) Central Panel & Local Daemon (Full Setup) [Default]"
echo "  2) Central Panel Only (Controller Node)"
echo "  3) Daemon Only (Runner Agent Node)"
prompt_user "Enter choice (1-3) [Default: 1]: " "1" "INSTALL_MODE"

# 2. Directory prompt
prompt_user "Enter installation root directory [Default: /opt/aura]: " "/opt/aura" "AURA_ROOT"

# 3. Ports prompts
if [ "$INSTALL_MODE" -eq 1 ] || [ "$INSTALL_MODE" -eq 2 ]; then
  prompt_user "Enter AuraPanel Web Port [Default: 3000]: " "3000" "PANEL_PORT"
fi

if [ "$INSTALL_MODE" -eq 1 ] || [ "$INSTALL_MODE" -eq 3 ]; then
  prompt_user "Enter AuraDaemon Listen Port [Default: 21013]: " "21013" "DAEMON_PORT"
  prompt_user "Enter AuraDaemon Bind Address [Default: 0.0.0.0]: " "0.0.0.0" "DAEMON_BIND"
fi

echo -e "\n${BLUE}* Verifying system dependencies...${NC}"

# 4. Dependency Installation
install_node() {
  echo -e "${YELLOW}Installing/Upgrading Node.js (Target: LTS / v20)...${NC}"
  if [ -f /etc/debian_version ]; then
    apt-get update -y
    apt-get install -y curl git unzip build-essential
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
  elif [ -f /etc/redhat-release ] || [ -f /etc/system-release ]; then
    yum install -y curl git unzip gcc-c++ make
    curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
    yum install -y nodejs
  else
    echo -e "${RED}Unsupported OS type. Please install Node.js >= 18, git, and unzip manually.${NC}"
    exit 1
  fi
}

# Verify Node.js
if ! command -v node &> /dev/null; then
  install_node
else
  NODE_VER=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
  if [ "$NODE_VER" -lt 18 ]; then
    echo -e "${YELLOW}Detected outdated Node.js ($NODE_VER). Upgrading...${NC}"
    install_node
  else
    echo -e "${GREEN}✔ Node.js $(node -v) is already installed.${NC}"
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
  SRC_DIR="."
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
  if [ -z "$DAEMON_KEY" ] && [ -f "$AURA_ROOT/daemon/config.json" ]; then
    DAEMON_KEY=$(node -e "console.log(require('$AURA_ROOT/daemon/config.json').key)" 2>/dev/null || true)
  fi
  
  if [ -n "$DAEMON_KEY" ]; then
    echo -e "  - Secure Daemon Key: ${GREEN}${DAEMON_KEY}${NC}"
  else
    echo -e "  - Secure Daemon Key: (Start daemon service to generate first key)"
  fi
fi

echo -e "\n${BOLD}Useful Administration Commands:${NC}"
echo -e "  - Check system status:     ${YELLOW}aura status${NC}"
echo -e "  - Check nodes status:      ${YELLOW}aura nodes ls${NC}"
echo -e "  - Check server instances:  ${YELLOW}aura instances ls${NC}"
echo -e "  - Open server console:     ${YELLOW}aura instance <instance-id> console${NC}"
echo -e "  - Check environment health: ${YELLOW}aura healthchecks${NC}"
echo "=========================================================="
