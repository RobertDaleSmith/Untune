import SwiftUI

struct ArtistDetailView: View {
    let artist: ArtistInfo
    let allTracks: [Track]
    @Environment(AudioPlayer.self) private var audioPlayer

    private var artistTracks: [Track] {
        allTracks.filter { $0.displayArtist == artist.name }
    }

    private var artistAlbums: [AlbumInfo] {
        let grouped = Dictionary(grouping: artistTracks) { $0.displayAlbum }
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
        .sorted { ($0.year ?? 0) > ($1.year ?? 0) }
    }

    private let columns = [
        GridItem(.adaptive(minimum: 200, maximum: 250), spacing: 30)
    ]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 30) {
                // Artist header
                HStack(spacing: 30) {
                    ArtworkView(artworkHash: artist.artworkHash, size: 200, cornerRadius: 100)
                    VStack(alignment: .leading, spacing: 8) {
                        Text(artist.name)
                            .font(.title2)
                        Text("\(artist.albumCount) albums, \(artist.trackCount) tracks")
                            .font(.body)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    Button {
                        audioPlayer.play(tracks: artistTracks)
                    } label: {
                        Label("Play All", systemImage: "play.fill")
                    }
                    Button {
                        if !audioPlayer.shuffle { audioPlayer.toggleShuffle() }
                        let randomIndex = Int.random(in: 0..<max(1, artistTracks.count))
                        audioPlayer.play(tracks: artistTracks, startIndex: randomIndex)
                    } label: {
                        Label("Shuffle", systemImage: "shuffle")
                    }
                }
                .padding(.horizontal, 40)

                // Albums grid
                LazyVGrid(columns: columns, spacing: 30) {
                    ForEach(artistAlbums) { album in
                        NavigationLink(value: album) {
                            VStack(alignment: .leading, spacing: 8) {
                                ArtworkView(artworkHash: album.artworkHash, size: 200, cornerRadius: 12)
                                Text(album.name)
                                    .font(.body)
                                    .lineLimit(1)
                                if let year = album.year {
                                    Text("\(year)")
                                        .font(.subheadline)
                                        .foregroundStyle(.secondary)
                                }
                            }
                            .frame(width: 200)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 40)
            }
            .padding(.vertical, 30)
        }
        .navigationDestination(for: AlbumInfo.self) { album in
            AlbumDetailView(album: album, allTracks: allTracks)
        }
    }
}
