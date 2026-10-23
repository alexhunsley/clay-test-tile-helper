build:
    python3 scripts/build.py

deploy: build
    mkdir -p /Users/alexhunsley/Documents/dev/blog/static/test_tiles
    cp -f index.html /Users/alexhunsley/Documents/dev/blog/static/test_tiles/index.html
