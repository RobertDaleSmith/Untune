import SwiftUI

struct ContentView: View {
    @Environment(AudioPlayer.self) private var audioPlayer
    @Environment(PairingManager.self) private var pairingManager
    @Environment(HandoffManager.self) private var handoffManager

    var body: some View {
        ZStack {
            TabView {
                LibraryView()
                    .tabItem {
                        Label("Library", systemImage: "music.note.house")
                    }

                NowPlayingView()
                    .tabItem {
                        Label("Now Playing", systemImage: "play.circle")
                    }

                SettingsView()
                    .tabItem {
                        Label("Settings", systemImage: "gear")
                    }
            }

            // Handoff banner — full-width card at top for 10-foot UI
            if let state = handoffManager.remoteState, let track = handoffManager.remoteTrack {
                VStack {
                    HandoffCardView(state: state, track: track, player: audioPlayer, handoffManager: handoffManager)
                        .transition(.move(edge: .top).combined(with: .opacity))
                    Spacer()
                }
                .padding(.top, 40)
            }
        }
    }
}

// MARK: - Handoff Card (10-foot UI)

private struct HandoffCardView: View {
    let state: HandoffManager.HandoffState
    let track: Track
    let player: AudioPlayer
    let handoffManager: HandoffManager

    var body: some View {
        HStack(spacing: 24) {
            // Info
            VStack(alignment: .leading, spacing: 4) {
                Text(track.title)
                    .font(.headline)
                    .lineLimit(1)
                if let artist = track.artist {
                    Text(artist)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                Text("Paused at \(formatTime(state.position)) on \(state.deviceName)")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            }

            Spacer()

            // Actions
            Button("Resume") {
                resumeFromHandoff()
            }

            Button("Dismiss") {
                handoffManager.dismiss()
            }
        }
        .padding(24)
        .background(.regularMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 20))
        .padding(.horizontal, 60)
    }

    private func resumeFromHandoff() {
        guard let tracks = try? DatabaseManager.shared.fetchAllTracks() else { return }
        let idx = tracks.firstIndex(where: { $0.id == track.id }) ?? 0
        player.play(tracks: tracks, startIndex: idx)
        if state.position > 0 {
            player.seek(to: state.position)
        }
        handoffManager.dismiss()
    }

    private func formatTime(_ seconds: Double) -> String {
        let mins = Int(seconds) / 60
        let secs = Int(seconds) % 60
        return "\(mins):\(String(format: "%02d", secs))"
    }
}
