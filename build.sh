set -e

cairosvg vuepy-avator.svg -o icon.png -W 256 -H 256

vsce package --allow-missing-repository
