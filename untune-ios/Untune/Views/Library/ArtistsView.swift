import SwiftUI

struct ArtistsView: View {
    @Environment(AudioPlayer.self) private var audioPlayer
    let tracks: [Track]

    private var artists: [(name: String, trackCount: Int, tracks: [Track])] {
        let grouped = Dictionary(grouping: tracks) { $0.albumArtist.nonEmpty ?? $0.artist.nonEmpty ?? "Unknown Artist" }
        return grouped.map { key, tracks in
            (name: key, trackCount: tracks.count, tracks: tracks.sorted { $0.title < $1.title })
        }
        .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    var body: some View {
        List {
            ForEach(artists, id: \.name) { artist in
                NavigationLink {
                    ArtistDetailView(artistName: artist.name, tracks: artist.tracks)
                } label: {
                    HStack(spacing: 12) {
                        ArtistAvatar(name: artist.name, size: 44)

                        VStack(alignment: .leading, spacing: 2) {
                            Text(artist.name)
                                .font(.body)
                            Text("\(artist.trackCount) songs")
                                .font(.caption)
                                .foregroundStyle(.secondary)
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

struct ArtistAvatar: View {
    let name: String
    let size: CGFloat

    private var initial: String {
        String(name.prefix(1)).uppercased()
    }

    private var gradientColors: [Color] {
        // Deterministic hash (djb2) — Swift's hashValue is randomized per launch
        let hash = name.utf8.reduce(5381) { ($0 &<< 5) &+ $0 &+ Int($1) }
        let hue1 = Double(abs(hash) % 360) / 360.0
        let hue2 = (hue1 + 0.15).truncatingRemainder(dividingBy: 1.0)
        return [
            Color(hue: hue1, saturation: 0.6, brightness: 0.8),
            Color(hue: hue2, saturation: 0.7, brightness: 0.6)
        ]
    }

    var body: some View {
        ZStack {
            Circle()
                .fill(
                    LinearGradient(
                        colors: gradientColors,
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
            Text(initial)
                .font(.system(size: size * 0.4, weight: .bold, design: .rounded))
                .foregroundStyle(.white)
        }
        .frame(width: size, height: size)
    }
}
