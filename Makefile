test: deps
	@rm -rf node_modules/somedom && CI=1 npm test

ci: deps
	@npm test && npm run test:bin

dev: deps
	@npm run build:fast -- --watch & npm run dev

clean:
	@rm -rf node_modules

install: deps
	@npm run build:fast
	@(((which mortero) > /dev/null 2>&1) || npm link) || true

deps: package*.json
	@(((ls node_modules | grep .) > /dev/null 2>&1) || npm i) || true
