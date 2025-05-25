OS := $(shell uname -s)

install-deps:
	@if [ "$(OS)" = "Darwin" ]; then \
		echo "Detected macOS. Installing using Homebrew..."; \
		bash -ex assets/scripts/mac_deps.sh; \
	elif [ "$(OS)" = "Windows_NT" ]; then \
		echo "Detected Windows. Installing using winget..."; \
		pwsh -Command "& .\assets\scripts\win_deps.ps1"; \
	else \
		echo "Detected Unix/Linux. Skipping install..."; \
	fi
