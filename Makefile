.PHONY: dev build check install clean

# Install frontend dependencies
install:
	pnpm install

# Run in development (Tauri + Vite HMR)
dev:
	pnpm tauri dev

# Build production app bundle
build:
	pnpm tauri build

# Type-check frontend and backend without building
check:
	npx tsc --noEmit
	cd src-tauri && cargo check

# Remove build artifacts
clean:
	rm -rf dist
	cd src-tauri && cargo clean
