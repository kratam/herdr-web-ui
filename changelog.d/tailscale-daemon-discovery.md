### Fixed
- A Tailscale CLI szűk PATH mellett is megtalálható macOS-en. A nyílt forrású démon socketje
  mellett a felderítés nem indítja el a külön Tailscale.app-démont; a státuszolvasás és a plugin
  megosztása is a megfelelő socketet használja.
