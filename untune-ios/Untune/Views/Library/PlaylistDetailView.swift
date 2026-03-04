import SwiftUI

struct PlaylistDetailView: View {
    @Environment(AudioPlayer.self) private var audioPlayer
    let playlist: Playlist
    @State private var tracks: [Track] = []
    @State private var scrollTracker = ScrollTracker()

    var body: some View {
        ScrollViewReader { proxy in
            List {
                // Header
                Section {
                    VStack(spacing: 8) {
                        ArtworkView(tracks.first?.artworkHash, size: 120)

                        Text(playlist.name)
                            .font(.title2)
                            .fontWeight(.bold)

                        Text("\(tracks.count) songs")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)

                        HStack(spacing: 16) {
                            Button {
                                audioPlayer.play(tracks: tracks)
                            } label: {
                                Label("Play", systemImage: "play.fill")
                                    .font(.headline)
                                    .foregroundStyle(.white)
                                    .frame(maxWidth: .infinity)
                            }
                            .buttonStyle(.borderedProminent)
                            .disabled(tracks.isEmpty)

                            Button {
                                var shuffled = tracks
                                shuffled.shuffle()
                                audioPlayer.play(tracks: shuffled)
                            } label: {
                                Label("Shuffle", systemImage: "shuffle")
                                    .font(.headline)
                                    .frame(maxWidth: .infinity)
                            }
                            .buttonStyle(.bordered)
                            .disabled(tracks.isEmpty)
                        }
                        .padding(.top, 4)
                    }
                    .frame(maxWidth: .infinity)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets(top: 0, leading: 0, bottom: 0, trailing: 0))
                    .padding()
                }

                // Track list
                Section {
                    ForEach(Array(tracks.enumerated()), id: \.element.id) { index, track in
                        TrackRow(
                            track: track,
                            isPlaying: audioPlayer.currentTrack?.id == track.id
                        )
                        .id(track.id)
                        .listRowBackground(Color.clear)
                        .onTapGesture {
                            audioPlayer.play(tracks: tracks, startIndex: index)
                        }
                    }
                }
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .simultaneousGesture(
                DragGesture(minimumDistance: 5)
                    .onChanged { _ in scrollTracker.dragChanged() }
                    .onEnded { _ in scrollTracker.dragEnded() }
            )
            .navigationTitle(playlist.name)
            .navigationBarTitleDisplayMode(.inline)
            .onAppear {
                loadTracks()
                if let id = audioPlayer.currentTrack?.id {
                    proxy.scrollTo(id, anchor: .center)
                }
            }
            .onChange(of: audioPlayer.currentTrack?.id) { _, newId in
                guard let newId, !scrollTracker.userIsScrolling else { return }
                withAnimation {
                    proxy.scrollTo(newId, anchor: .center)
                }
            }
        }
    }

    private func loadTracks() {
        do {
            tracks = try DatabaseManager.shared.fetchTracks(forPlaylist: playlist.id)
        } catch {
            print("Failed to load playlist tracks: \(error)")
        }
    }
}
