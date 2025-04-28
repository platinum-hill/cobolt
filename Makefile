OS := $(shell uname -s)

install-deps:
	@if [ "$(OS)" = "Darwin" ]; then \
		echo "Detected macOS. Installing using Homebrew..."; \
		bash -ex assets/scripts/mac_deps.sh; \
	elif [ "$(OS)" = "Windows_NT" ]; then \
		echo "Detected Windows. Installing using winget..."; \
		cmd /c .\assets\scripts\win_deps.bat; \
	else \
		echo "Detected Unix/Linux. Skipping install..."; \
	fi
