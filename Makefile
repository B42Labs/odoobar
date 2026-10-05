# make build   build dist/mac-arm64/OdooBar.app in Docker
# make run     build if needed, then start the app with a test profile
# make reset   delete the test profile, so the next run is a first start
# make clean   delete the built app and the test profile

APP     := dist/mac-arm64/OdooBar.app
# Keeps test runs away from ~/Library/Application Support/OdooBar. Under
# --user-data-dir the app also leaves the macOS login item alone.
PROFILE ?= $(CURDIR)/.test-profile
# Extra arguments for the app, for example ARGS=--lang=en
ARGS    ?=

SOURCES := Dockerfile .dockerignore package.json package-lock.json \
           tsconfig.json electron-builder.yml $(shell find src test -type f)

.PHONY: build run reset clean

build: $(APP)

# The container compiles and packages, but only macOS can sign. Without the
# codesign step the bundle keeps the signature of Electron's own executable,
# which names the app "Electron" and covers neither Info.plist nor resources.
$(APP): $(SOURCES)
	rm -rf $(APP)
	docker build --target app --output type=local,dest=$(dir $(APP)) .
	codesign --force --deep --sign - $(APP)
	touch $(APP)

run: $(APP)
	$(APP)/Contents/MacOS/OdooBar --user-data-dir="$(PROFILE)" $(ARGS)

reset:
	rm -rf "$(PROFILE)"

clean: reset
	rm -rf $(APP)
