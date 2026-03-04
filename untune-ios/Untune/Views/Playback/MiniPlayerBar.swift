import SwiftUI

struct MiniPlayerBar: View {
    @Environment(AudioPlayer.self) private var audioPlayer
    @Environment(\.colorScheme) private var colorScheme
    @Binding var showNowPlaying: Bool

    private func playRandom() {
        guard var tracks = try? DatabaseManager.shared.fetchAllTracks(), !tracks.isEmpty else { return }
        tracks.shuffle()
        audioPlayer.play(tracks: tracks)
    }

    var body: some View {
        VStack(spacing: 0) {
            if let track = audioPlayer.currentTrack {
                // Progress bar
                GeometryReader { geo in
                    Rectangle()
                        .fill(audioPlayer.accentColor ?? (colorScheme == .dark ? .white : .black))
                        .frame(width: geo.size.width * audioPlayer.progress, height: 2)
                }
                .frame(height: 2)

                HStack(spacing: 12) {
                    ArtworkView(track.artworkHash, size: 40)

                    VStack(alignment: .leading, spacing: 1) {
                        Text(track.title)
                            .font(.subheadline)
                            .fontWeight(.medium)
                            .lineLimit(1)
                        Text(track.displayArtist)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }

                    Spacer()

                    Button { audioPlayer.togglePlayPause() } label: {
                        Image(systemName: audioPlayer.isPlaying ? "pause.fill" : "play.fill")
                            .font(.title3)
                            .frame(width: 44, height: 44)
                    }

                    Button { audioPlayer.next() } label: {
                        Image(systemName: "forward.fill")
                            .font(.body)
                            .frame(width: 44, height: 44)
                    }
                }
                .padding(.horizontal, 12)
                .padding(.top, 6)
                .padding(.bottom, 2)
            } else {
                HStack(spacing: 12) {
                    RoundedRectangle(cornerRadius: 6)
                        .fill(.quaternary)
                        .frame(width: 40, height: 40)

                    Text("Not Playing")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)

                    Spacer()

                    Button { playRandom() } label: {
                        Image(systemName: "play.fill")
                            .font(.title3)
                            .frame(width: 44, height: 44)
                    }

                    Button {} label: {
                        Image(systemName: "forward.fill")
                            .font(.body)
                            .frame(width: 44, height: 44)
                    }
                    .disabled(true)
                }
                .padding(.horizontal, 12)
                .padding(.top, 6)
                .padding(.bottom, 2)
            }
        }
        .ignoresSafeArea(.container, edges: .bottom)
        .background(.ultraThinMaterial)
        .contentShape(Rectangle())
        .onTapGesture {
            if audioPlayer.currentTrack != nil {
                showNowPlaying = true
            }
        }
        .gesture(
            DragGesture(minimumDistance: 20)
                .onEnded { value in
                    if audioPlayer.currentTrack != nil && value.translation.height < -30 {
                        showNowPlaying = true
                    }
                }
        )
    }
}
