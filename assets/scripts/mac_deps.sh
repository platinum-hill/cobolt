#!/bin/bash

echo "======================================================"
echo "          Installing Cobolt dependencies"
echo "======================================================"
echo ""

# Check if Xcode Command Line Tools are installed
if ! xcode-select -p &> /dev/null; then
    echo "Installing Xcode Command Line Tools..."
    # Touch a temporary file to trigger the Xcode CLT installation prompt
    touch /tmp/.com.apple.dt.CommandLineTools.installondemand.in-progress
    
    # Get the latest Xcode CLT package name
    PROD=$(softwareupdate -l | grep "\*.*Command Line" | head -n 1 | awk -F"*" '{print $2}' | sed -e 's/^ *//' | tr -d '\n')
    
    # Install Xcode CLT silently
    softwareupdate -i "$PROD" --verbose
    
    # Clean up
    rm /tmp/.com.apple.dt.CommandLineTools.installondemand.in-progress
    
    echo "Xcode Command Line Tools installed successfully."
else
    echo "Xcode Command Line Tools already installed."
fi

# Check if Homebrew is installed
echo "[1/3] Checking for Homebrew..."
    # Add Homebrew to PATH for this session
    echo "uname -m: $(uname -m)"
    # More reliable way to detect Apple Silicon
    if [[ -d "/opt/homebrew" ]] || [[ $(sysctl -n machdep.cpu.brand_string) == *"Apple"* ]]; then
        echo "Installing Homebrew for Apple Silicon..."
        prefix="/opt/homebrew"
    else
        echo "Installing Homebrew for Intel..."
        prefix="/usr/local"
    fi
    eval "$(${prefix}/bin/brew shellenv)"

if ! command -v brew &> /dev/null; then
    echo "Homebrew not found."
    echo "Error: Homebrew is required but not installed. Please install Homebrew first." >&2
    exit 1
else
    echo "Homebrew installed at $(which brew)"
fi

# Check Python version
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
        brew install python@3.11
        echo "Python 3.11+ installed successfully."
    fi
else
    echo "Python not found. Installing Python 3.11+..."
    brew install python@3.11
    echo "Python 3.11+ installed successfully."
fi
echo "Python version: $(python3 --version)"

# Install dependencies
echo ""
echo "[3/3] Installing required system dependencies..."
DEPENDENCIES="libidn2 mbedtls openssl@3 libsodium ollama"

for dep in $DEPENDENCIES; do
    echo "Checking $dep..."
    if ! brew list | grep -q "$dep"; then
        echo "Installing $dep..."
        brew install $dep
        echo "$dep installed successfully."
    else
        echo "$dep is already installed."
    fi
done