import SwiftUI

struct AlbumsView: View {
    @Environment(AudioPlayer.self) private var audioPlayer
    let tracks: [Track]

    private var albums: [(name: String, artist: String, tracks: [Track])] {
        let grouped = Dictionary(grouping: tracks) { $0.album ?? "Unknown Album" }
        return grouped.map { key, tracks in
            let sortedTracks = tracks.sorted {
                ($0.discNumber ?? 1, $0.trackNumber ?? 0) < ($1.discNumber ?? 1, $1.trackNumber ?? 0)
            }
            let artist = sortedTracks.first?.albumArtist.nonEmpty ?? sortedTracks.first?.artist.nonEmpty ?? "Unknown Artist"
            return (name: key, artist: artist, tracks: sortedTracks)
        }
        .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    var body: some View {
        List {
            ForEach(albums, id: \.name) { album in
                NavigationLink {
                    AlbumDetailView(albumName: album.name, artistName: album.artist, tracks: album.tracks)
                } label: {
                    HStack(spacing: 12) {
                        ArtworkView(album.tracks.first?.artworkHash, size: 50)

                        VStack(alignment: .leading, spacing: 2) {
                            Text(album.name)
                                .font(.body)
                                .lineLimit(1)
                            Text(album.artist)
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                            Text("\(album.tracks.count) songs")
                                .font(.caption)
                                .foregroundStyle(.tertiary)
                        }
                    }
                }
                .listRowBackground(Color.clear)
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
    }

}
