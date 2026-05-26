import CarPlay

class CarPlayBrowser {
    private let interfaceController: CPInterfaceController

    init(interfaceController: CPInterfaceController) {
        self.interfaceController = interfaceController
    }

    // MARK: - Tabs

    func playlistsTab() -> CPListTemplate {
        let items: [CPListItem]
        if let playlists = try? DatabaseManager.shared.fetchAllPlaylists() {
            items = playlists.prefix(100).map { playlist in
                let item = CPListItem(
                    text: playlist.name,
                    detailText: "\(playlist.trackCount) tracks"
                )
                item.handler = { [weak self] _, completion in
                    self?.showPlaylistDetail(playlist)
                    completion()
                }
                return item
            }
        } else {
            items = []
        }

        let template = CPListTemplate(title: "Playlists", sections: [
            CPListSection(items: items),
        ])
        template.tabImage = UIImage(systemName: "music.note.list")
        return template
    }

    func artistsTab() -> CPListTemplate {
        let items: [CPListItem]
        if let artists = try? DatabaseManager.shared.fetchArtistSummaries() {
            items = artists.prefix(200).map { artist in
                let item = CPListItem(
                    text: artist.name,
                    detailText: "\(artist.trackCount) tracks"
                )
                item.handler = { [weak self] _, completion in
                    self?.showArtistDetail(artist)
                    completion()
                }
                return item
            }
        } else {
            items = []
        }

        let template = CPListTemplate(title: "Artists", sections: [
            CPListSection(items: items),
        ])
        template.tabImage = UIImage(systemName: "music.mic")
        return template
    }

    func albumsTab() -> CPListTemplate {
        let items: [CPListItem]
        if let albums = try? DatabaseManager.shared.fetchAlbumSummaries() {
            items = albums.prefix(200).map { album in
                let image = album.artworkHash.flatMap { ArtworkCache.shared.image(forHash: $0) }
                let item = CPListItem(
                    text: album.name,
                    detailText: album.artist,
                    image: image
                )
                item.handler = { [weak self] _, completion in
                    self?.showAlbumDetail(album)
                    completion()
                }
                return item
            }
        } else {
            items = []
        }

        let template = CPListTemplate(title: "Albums", sections: [
            CPListSection(items: items),
        ])
        template.tabImage = UIImage(systemName: "square.stack")
        return template
    }

    // MARK: - Drill-Down Views

    private func showPlaylistDetail(_ playlist: Playlist) {
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            let tracks = (try? DatabaseManager.shared.fetchTracks(forPlaylist: playlist.id)) ?? []
            DispatchQueue.main.async {
                self?.showTrackList(title: playlist.name, tracks: tracks)
            }
        }
    }

    private func showArtistDetail(_ artist: DatabaseManager.ArtistSummary) {
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            let tracks = (try? DatabaseManager.shared.fetchTracksForArtist(artist.name)) ?? []
            DispatchQueue.main.async {
                guard let self else { return }

                // Group by album
                let albumGroups = Dictionary(grouping: tracks) { $0.album ?? "Unknown Album" }
                let sortedAlbums = albumGroups.map { name, albumTracks -> (String, String, [Track]) in
                    let sorted = albumTracks.sorted {
                        ($0.discNumber ?? 1, $0.trackNumber ?? 0) < ($1.discNumber ?? 1, $1.trackNumber ?? 0)
                    }
                    let albumArtist = sorted.first?.albumArtist.nonEmpty ?? sorted.first?.artist.nonEmpty ?? "Unknown Artist"
                    return (name, albumArtist, sorted)
                }.sorted { $0.0.localizedCaseInsensitiveCompare($1.0) == .orderedAscending }

                if sortedAlbums.count == 1 {
                    self.showTrackList(title: artist.name, tracks: tracks)
                    return
                }

                // Play All + album list
                let playAll = CPListItem(text: "Play All", detailText: "\(tracks.count) tracks")
                playAll.handler = { _, completion in
                    AudioPlayer.shared.play(tracks: tracks)
                    completion()
                }

                let albumItems = sortedAlbums.map { name, _, albumTracks in
                    let image = albumTracks.first.flatMap { self.artworkThumbnail(for: $0) }
                    let item = CPListItem(
                        text: name,
                        detailText: "\(albumTracks.count) tracks",
                        image: image
                    )
                    item.handler = { [weak self] _, completion in
                        self?.showTrackList(title: name, tracks: albumTracks)
                        completion()
                    }
                    return item
                }

                let template = CPListTemplate(title: artist.name, sections: [
                    CPListSection(items: [playAll]),
                    CPListSection(items: albumItems),
                ])
                self.interfaceController.pushTemplate(template, animated: true, completion: nil)
            }
        }
    }

    private func showAlbumDetail(_ album: DatabaseManager.AlbumSummary) {
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            let tracks = (try? DatabaseManager.shared.fetchTracksForAlbum(album.name)) ?? []
            DispatchQueue.main.async {
                self?.showTrackList(title: album.name, tracks: tracks)
            }
        }
    }

    private func showTrackList(title: String, tracks: [Track]) {
        let items = tracks.prefix(100).enumerated().map { index, track in
            let image = artworkThumbnail(for: track)
            let item = CPListItem(
                text: track.title,
                detailText: track.displayArtist,
                image: image
            )
            item.handler = { _, completion in
                AudioPlayer.shared.play(tracks: tracks, startIndex: index)
                completion()
            }
            return item
        }

        let template = CPListTemplate(title: title, sections: [
            CPListSection(items: items),
        ])
        interfaceController.pushTemplate(template, animated: true, completion: nil)
    }

    // MARK: - Artwork

    private func artworkThumbnail(for track: Track?) -> UIImage? {
        guard let hash = track?.artworkHash else { return nil }
        return ArtworkCache.shared.image(forHash: hash)
    }
}
