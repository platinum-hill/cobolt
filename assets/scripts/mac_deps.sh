#!/bin/bash

echo "======================================================"
echo "          Installing Cobolt dependencies"
echo "======================================================"
echo ""

# Check if Homebrew is installed
echo "[1/3] Checking for Homebrew..."
if ! command -v brew &> /dev/null; then
    echo "Homebrew not found. Installing Homebrew..."
    curl -L https://github.com/Homebrew/brew/tarball/master | tar xz --strip 1 -C homebrew
    pwd
    ls 

    eval "$(bin/brew shellenv)"
    # Add Homebrew to PATH for this session
    # if [[ $(uname -m) == 'arm64' ]]; then
    #     eval "$(homebrew/bin/brew shellenv)"
    # else
    #     eval "$(/usr/local/bin/brew shellenv)"
    # fi
else
    echo "Homebrew is already installed."
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
    echo "Python version: $(python3 --version)"
fi

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
