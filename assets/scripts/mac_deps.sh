#!/bin/bash
echo "======================================================"
echo "          Installing Cobolt dependencies"
echo "======================================================"
echo ""

# Check if Homebrew is installed
echo "[1/3] Checking for Homebrew..."
    # Add Homebrew to PATH for this session
    if [[ -d "/opt/homebrew" ]] || [[ $(sysctl -n machdep.cpu.brand_string) == *"Apple"* ]]; then
        echo "Installing Homebrew for Apple Silicon..."
        prefix="/opt/homebrew"
        is_apple_silicon=true
    else
        echo "Installing Homebrew for Intel..."
        prefix="/usr/local"
        is_apple_silicon=false
    fi
    eval "$(${prefix}/bin/brew shellenv)"

if ! command -v brew &> /dev/null; then
    echo "Install the Homebrew package manager and open the app again." >&2 
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
        if [ "$is_apple_silicon" = true ]; then
            arch -arm64 brew install python@3.11
        else
            brew install python@3.11
        fi
        echo "Python 3.11+ installed successfully."
    fi
else
    echo "Python not found. Installing Python 3.11+..."
    if [ "$is_apple_silicon" = true ]; then
        arch -arm64 brew install python@3.11
    else
        brew install python@3.11
    fi
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
        if [ "$is_apple_silicon" = true ]; then
            arch -arm64 brew install $dep
        else
            brew install $dep
        fi
        echo "$dep installed successfully."
    else
        echo "$dep is already installed."
    fi
done