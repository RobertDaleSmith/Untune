import SwiftUI

struct ArtistInfo: Identifiable, Hashable {
    let id: String
    let name: String
    let artworkHash: String?
    let trackCount: Int
    let albumCount: Int

    init(name: String, artworkHash: String?, trackCount: Int, albumCount: Int) {
        self.id = name
        self.name = name
        self.artworkHash = artworkHash
        self.trackCount = trackCount
        self.albumCount = albumCount
    }
}

struct ArtistsGridView: View {
    let tracks: [Track]

    private var artists: [ArtistInfo] {
        let grouped = Dictionary(grouping: tracks) { $0.displayArtist }
        return grouped.map { (artist, artistTracks) in
            let albums = Set(artistTracks.map { $0.displayAlbum })
            return ArtistInfo(
                name: artist,
                artworkHash: artistTracks.first?.artworkHash,
                trackCount: artistTracks.count,
                albumCount: albums.count
            )
        }
        .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    private let columns = [
        GridItem(.adaptive(minimum: 250, maximum: 300), spacing: 40)
    ]

    var body: some View {
        if tracks.isEmpty {
            ContentUnavailableView(
                "No Artists",
                systemImage: "music.mic",
                description: Text("Sync with your desktop to see artists here.")
            )
        } else {
            ScrollView {
                LazyVGrid(columns: columns, spacing: 40) {
                    ForEach(artists) { artist in
                        NavigationLink(value: artist) {
                            VStack(spacing: 10) {
                                ArtworkView(artworkHash: artist.artworkHash, size: 250, cornerRadius: 125)
                                Text(artist.name)
                                    .font(.body)
                                    .lineLimit(1)
                                Text("\(artist.albumCount) albums")
                                    .font(.subheadline)
                                    .foregroundStyle(.secondary)
                            }
                            .frame(width: 250)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(40)
            }
            .navigationDestination(for: ArtistInfo.self) { artist in
                ArtistDetailView(artist: artist, allTracks: tracks)
            }
        }
    }
}
