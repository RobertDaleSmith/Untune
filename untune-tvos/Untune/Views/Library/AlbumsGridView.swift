import SwiftUI

struct AlbumInfo: Identifiable, Hashable {
    let id: String
    let name: String
    let artist: String
    let artworkHash: String?
    let trackCount: Int
    let year: Int?

    init(name: String, artist: String, artworkHash: String?, trackCount: Int, year: Int?) {
        self.id = "\(artist)-\(name)"
        self.name = name
        self.artist = artist
        self.artworkHash = artworkHash
        self.trackCount = trackCount
        self.year = year
    }
}

struct AlbumsGridView: View {
    let tracks: [Track]

    private var albums: [AlbumInfo] {
        let grouped = Dictionary(grouping: tracks) { track in
            "\(track.displayArtist)-\(track.displayAlbum)"
        }
        return grouped.values.compactMap { albumTracks -> AlbumInfo? in
            guard let first = albumTracks.first else { return nil }
            return AlbumInfo(
                name: first.displayAlbum,
                artist: first.displayArtist,
                artworkHash: first.artworkHash,
                trackCount: albumTracks.count,
                year: first.year
            )
        }
        .sorted { ($0.artist, $0.name) < ($1.artist, $1.name) }
    }

    private let columns = [
        GridItem(.adaptive(minimum: 250, maximum: 300), spacing: 40)
    ]

    var body: some View {
        if tracks.isEmpty {
            ContentUnavailableView(
                "No Albums",
                systemImage: "square.stack",
                description: Text("Sync with your desktop to see albums here.")
            )
        } else {
            ScrollView {
                LazyVGrid(columns: columns, spacing: 40) {
                    ForEach(albums) { album in
                        NavigationLink(value: album) {
                            VStack(alignment: .leading, spacing: 10) {
                                ArtworkView(artworkHash: album.artworkHash, size: 250, cornerRadius: 16)
                                Text(album.name)
                                    .font(.body)
                                    .lineLimit(1)
                                Text(album.artist)
                                    .font(.subheadline)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(1)
                            }
                            .frame(width: 250)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(40)
            }
            .navigationDestination(for: AlbumInfo.self) { album in
                AlbumDetailView(album: album, allTracks: tracks)
            }
        }
    }
}
