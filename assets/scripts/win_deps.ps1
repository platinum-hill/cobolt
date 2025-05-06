echo ======================================================
echo          Installing Cobolt dependencies
echo ======================================================
echo .

function Update-PathEnvironment {
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
}

# update the PATH environment before running the script
Update-PathEnvironment

# Check if winget is installed
try {
    # Try to get winget command
    $wingetCommand = Get-Command winget -ErrorAction Stop
    echo "winget is installed on this system. continuing..."
} catch {
    # If winget is not found, display an error message and exit with code 1
    echo "ERROR: winget is not installed on this system."
    echo "Please install the App Installer package from the Microsoft Store."
    echo "Exiting with error code 1."
    exit 1
}

# Check Python version
echo "Checking Python version..."
try {
    $pythonVersion = (python --version 2>&1).ToString().Split(" ")[1]
    echo "Found Python version: $pythonVersion"
    
    # Parse version components
    $versionParts = $pythonVersion.Split(".")
    $majorVersion = [int]$versionParts[0]
    $minorVersion = [int]$versionParts[1]
    
    # Check if version is below 3.11
    if ($majorVersion -lt 3 -or ($majorVersion -eq 3 -and $minorVersion -lt 11)) {
        echo "Python version is below 3.11. Will install Python 3.11..."
        $needPythonInstall = $true
    } else {
        echo "Python version is 3.11 or higher. No need to update."
        $needPythonInstall = $false
    }
} catch {
    echo "Python not found or error checking version."
    $needPythonInstall = $true
}

# Install Python 3.11 if needed
if ($needPythonInstall) {
    echo "Installing Python 3.11..."
    winget install -e --id Python.Python.3.11 --silent --accept-package-agreements --accept-source-agreements
    
    if ($LASTEXITCODE -ne 0) {
        echo "ERROR: Failed to install Python 3.11."
        Write-Error "Winget failed to install Python. Exit code: $LASTEXITCODE"
        exit 1
    }
} else {
    echo "Python 3.11 or higher is already installed."
}

#install Ollama if not installed
echo "installing Ollama"
$ollamaInstalled = winget list --id Ollama.Ollama 2>$null

if ($ollamaInstalled -match "Ollama.Ollama") {    
    echo "Ollama is already installed. Checking for updates..."
    
    # Try to upgrade Ollama. Dont error out if this fails, just continue
    $upgradeRes = winget upgrade --id Ollama.Ollama --silent --accept-package-agreements --accept-source-agreements 2>$nul

    if ($LASTEXITCODE -ne 0) {
        echo "No updates available for Ollama or upgrade failed."
    } else {
        echo "Ollama updated successfully."
    }

} else {
    echo "Ollama not found. Installing..."
    winget install -e --id Ollama.Ollama --silent --accept-package-agreements --accept-source-agreements

    # Check if the installation was successful. if not exit with code 1
    if ($LASTEXITCODE -ne 0) {
        echo "ERROR: Failed to install Ollama"
        Write-Error "Winget failed to install Ollama. Exit code: $LASTEXITCODE"
        exit 1
    }
}

# Update PATH to make newly installed programs available
Update-PathEnvironment

#install uv
echo "installing uvx"
pip install uv