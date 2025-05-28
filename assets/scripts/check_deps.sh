#!/bin/bash
echo "======================================================"
echo "          Checking Cobolt dependencies"
echo "======================================================"
echo ""

# Check Python installation
echo "[1/3] Checking Python installation..."
if command -v python3 &> /dev/null; then
    PYTHON_VERSION=$(python3 --version | cut -d' ' -f2)
    PYTHON_MAJOR=$(echo $PYTHON_VERSION | cut -d. -f1)
    PYTHON_MINOR=$(echo $PYTHON_VERSION | cut -d. -f2)
    
    if [ "$PYTHON_MAJOR" -ge 3 ] && [ "$PYTHON_MINOR" -ge 11 ]; then
        echo "✓ Python $PYTHON_VERSION is installed and up-to-date."
    else
        echo "✗ Python version $PYTHON_VERSION is outdated. Python 3.11+ is required."
    fi
else
    echo "✗ Python 3 is not installed. Please install Python 3.11+."
    exit 1
fi

echo ""
echo "[2/3] Checking system dependencies..."
DEPENDENCIES="libidn2-0 libmbedtls-dev openssl libsodium-dev"

for dep in $DEPENDENCIES; do
    if dpkg -l | grep -q "^ii  $dep "; then
        echo "✓ $dep is installed."
    else
        echo "✗ $dep is not installed."
        exit 1
    fi
done

echo ""
echo "[3/3] Checking Ollama installation..."
if command -v ollama &> /dev/null; then
    echo "✓ Ollama is installed."
else
    echo "✗ Ollama is not installed."
    exit 1
fi

echo ""
echo "======================================================"
echo "Note: If any dependencies are missing, please run the appropriate script to install them."
echo "Windows: run win_deps.ps1"
echo "macOS: run mac_deps.sh"
echo "Linux: run linux_deps.sh"
echo "======================================================" 