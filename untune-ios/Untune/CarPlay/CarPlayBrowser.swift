import CarPlay

class CarPlayBrowser {
    private let interfaceController: CPInterfaceController

    init(interfaceController: CPInterfaceController) {
        self.interfaceController = interfaceController
    }

    // MARK: - Tabs

    func nowPlayingTab() -> CPTemplate {
        let template = CPNowPlayingTemplate.shared
        template.isUpNextButtonEnabled = false
        return template
    }

    func playlistsTab() -> CPListTemplate {
        let items: [CPListItem]
        if let playlists = try? DatabaseManager.shared.fetchAllPlaylists() {
            items = playlists.map { playlist in
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
        let artists = loadArtists()
        let items = artists.map { artist in
            let item = CPListItem(
                text: artist.name,
                detailText: "\(artist.tracks.count) tracks"
            )
            item.handler = { [weak self] _, completion in
                self?.showArtistDetail(artist)
                completion()
            }
            return item
        }

        let template = CPListTemplate(title: "Artists", sections: [
            CPListSection(items: items),
        ])
        template.tabImage = UIImage(systemName: "music.mic")
        return template
    }

    func albumsTab() -> CPListTemplate {
        let albums = loadAlbums()
        let items = albums.map { album in
            let image = artworkThumbnail(for: album.tracks.first)
            let item = CPListItem(
                text: album.name,
                detailText: album.artist,
                image: image
            )
            item.handler = { [weak self] _, completion in
                self?.showTrackList(title: album.name, tracks: album.tracks)
                completion()
            }
            return item
        }

        let template = CPListTemplate(title: "Albums", sections: [
            CPListSection(items: items),
        ])
        template.tabImage = UIImage(systemName: "square.stack")
        return template
    }

    // MARK: - Drill-Down Views

    private func showPlaylistDetail(_ playlist: Playlist) {
        let tracks = (try? DatabaseManager.shared.fetchTracks(forPlaylist: playlist.id)) ?? []
        showTrackList(title: playlist.name, tracks: tracks)
    }

    private func showArtistDetail(_ artist: ArtistGroup) {
        let albumGroups = Dictionary(grouping: artist.tracks) { $0.album ?? "Unknown Album" }
        let sortedAlbums = albumGroups.map { name, tracks -> AlbumGroup in
            let sorted = tracks.sorted {
                ($0.discNumber ?? 1, $0.trackNumber ?? 0) < ($1.discNumber ?? 1, $1.trackNumber ?? 0)
            }
            let albumArtist = sorted.first?.albumArtist.nonEmpty ?? sorted.first?.artist.nonEmpty ?? "Unknown Artist"
            return AlbumGroup(name: name, artist: albumArtist, tracks: sorted)
        }.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }

        if sortedAlbums.count == 1 {
            showTrackList(title: artist.name, tracks: artist.tracks)
            return
        }

        // "Play All" + album list
        let playAll = CPListItem(text: "Play All", detailText: "\(artist.tracks.count) tracks")
        playAll.handler = { [weak self] _, completion in
            _ = self
            AudioPlayer.shared.play(tracks: artist.tracks)
            completion()
        }

        let albumItems = sortedAlbums.map { album in
            let image = artworkThumbnail(for: album.tracks.first)
            let item = CPListItem(
                text: album.name,
                detailText: "\(album.tracks.count) tracks",
                image: image
            )
            item.handler = { [weak self] _, completion in
                self?.showTrackList(title: album.name, tracks: album.tracks)
                completion()
            }
            return item
        }

        let template = CPListTemplate(title: artist.name, sections: [
            CPListSection(items: [playAll]),
            CPListSection(items: albumItems),
        ])
        interfaceController.pushTemplate(template, animated: true, completion: nil)
    }

    private func showTrackList(title: String, tracks: [Track]) {
        let items = tracks.enumerated().map { index, track in
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

    // MARK: - Data Loading

    private struct ArtistGroup {
        let name: String
        let tracks: [Track]
    }

    private struct AlbumGroup {
        let name: String
        let artist: String
        let tracks: [Track]
    }

    private func loadArtists() -> [ArtistGroup] {
        guard let tracks = try? DatabaseManager.shared.fetchAllTracks() else { return [] }
        let grouped = Dictionary(grouping: tracks) {
            $0.albumArtist.nonEmpty ?? $0.artist.nonEmpty ?? "Unknown Artist"
        }
        return grouped.map { name, tracks in
            ArtistGroup(name: name, tracks: tracks.sorted { $0.title < $1.title })
        }.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    private func loadAlbums() -> [AlbumGroup] {
        guard let tracks = try? DatabaseManager.shared.fetchAllTracks() else { return [] }
        let grouped = Dictionary(grouping: tracks) { $0.album ?? "Unknown Album" }
        return grouped.map { name, tracks in
            let sorted = tracks.sorted {
                ($0.discNumber ?? 1, $0.trackNumber ?? 0) < ($1.discNumber ?? 1, $1.trackNumber ?? 0)
            }
            let artist = sorted.first?.albumArtist.nonEmpty ?? sorted.first?.artist.nonEmpty ?? "Unknown Artist"
            return AlbumGroup(name: name, artist: artist, tracks: sorted)
        }.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    // MARK: - Artwork

    private func artworkThumbnail(for track: Track?) -> UIImage? {
        guard let hash = track?.artworkHash else { return nil }
        return ArtworkCache.shared.image(forHash: hash)
    }
}
