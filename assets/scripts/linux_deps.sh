#!/bin/bash
echo "======================================================"
echo "          Installing Cobolt dependencies"
echo "======================================================"
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    echo "The app requires root privileges to install dependencies. Please rerun the script as root user" >&2
    exit 1
fi

echo "[1/3] Checking package manager..."
if ! command -v apt-get &> /dev/null; then
    echo "This script requires apt package manager. Please install it or use a Debian/Ubuntu-based distribution." >&2
    exit 1
fi

echo "Updating package lists..."
apt-get update

echo ""
echo "[2/3] Checking Python installation..."
if command -v python3 &> /dev/null; then
    PYTHON_VERSION=$(python3 --version | cut -d' ' -f2)
    PYTHON_MAJOR=$(echo $PYTHON_VERSION | cut -d. -f1)
    PYTHON_MINOR=$(echo $PYTHON_VERSION | cut -d. -f2)
    
    if [ "$PYTHON_MAJOR" -ge 3 ] && [ "$PYTHON_MINOR" -ge 11 ]; then
        echo "Python $PYTHON_VERSION is already installed and up-to-date."
    else
        echo "Python version $PYTHON_VERSION is outdated. Installing Python 3.11+..."
        apt-get install -y software-properties-common
        add-apt-repository -y ppa:deadsnakes/ppa
        apt-get update
        apt-get install -y python3.11 python3.11-venv
        echo "Python 3.11+ installed successfully."
    fi
else
    echo "Python not found. Installing Python 3.11+..."
    apt-get install -y software-properties-common
    add-apt-repository -y ppa:deadsnakes/ppa
    apt-get update
    apt-get install -y python3.11 python3.11-venv
    echo "Python 3.11+ installed successfully."
fi

echo "Python version: $(python3 --version)"

echo ""
echo "[3/3] Installing required system dependencies..."
DEPENDENCIES="libidn2-0 libmbedtls-dev openssl libsodium-dev"

for dep in $DEPENDENCIES; do
    echo "Checking $dep..."
    if ! dpkg -l | grep -q "^ii  $dep "; then
        echo "Installing $dep..."
        apt-get install -y $dep
        echo "$dep installed successfully."
    else
        echo "$dep is already installed."
    fi
done

echo "Installing Ollama..."
if ! command -v ollama &> /dev/null; then
    curl -fsSL https://ollama.com/install.sh | sh
    echo "Ollama installed successfully."
else
    echo "Ollama is already installed."
fi 