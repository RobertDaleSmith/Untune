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
            let artist = sortedTracks.first?.albumArtist ?? sortedTracks.first?.artist ?? "Unknown Artist"
            return (name: key, artist: artist, tracks: sortedTracks)
        }
        .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    var body: some View {
        List {
            ForEach(albums, id: \.name) { album in
                NavigationLink {
                    albumDetailView(album)
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

    @ViewBuilder
    private func albumDetailView(_ album: (name: String, artist: String, tracks: [Track])) -> some View {
        ScrollViewReader { proxy in
        List {
            Section {
                VStack(spacing: 8) {
                    ArtworkView(album.tracks.first?.artworkHash, size: 200)
                    Text(album.name)
                        .font(.title2)
                        .fontWeight(.bold)
                    Text(album.artist)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)

                    Button {
                        audioPlayer.play(tracks: album.tracks)
                    } label: {
                        Label("Play All", systemImage: "play.fill")
                            .foregroundStyle(.white)
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .padding(.top, 4)
                }
                .frame(maxWidth: .infinity)
                .listRowBackground(Color.clear)
                .padding()
            }

            Section {
                ForEach(Array(album.tracks.enumerated()), id: \.element.id) { index, track in
                    HStack {
                        Text("\(track.trackNumber ?? (index + 1))")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .frame(width: 24)

                        VStack(alignment: .leading) {
                            Text(track.title)
                                .font(.body)
                                .foregroundStyle(audioPlayer.currentTrack?.id == track.id ? Color.accentColor : .primary)
                            if track.artist != album.artist {
                                Text(track.displayArtist)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }

                        Spacer()

                        Text(track.formattedDuration)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .monospacedDigit()
                    }
                    .contentShape(Rectangle())
                    .id(track.id)
                    .listRowBackground(Color.clear)
                    .onTapGesture {
                        audioPlayer.play(tracks: album.tracks, startIndex: index)
                    }
                }
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .navigationTitle(album.name)
        .navigationBarTitleDisplayMode(.inline)
        .onAppear {
            if let id = audioPlayer.currentTrack?.id {
                proxy.scrollTo(id, anchor: .center)
            }
        }
        }
    }
}
