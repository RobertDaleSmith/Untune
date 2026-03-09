import SwiftUI

struct ContentView: View {
    @Environment(AudioPlayer.self) private var audioPlayer
    @Environment(HandoffManager.self) private var handoffManager
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.scenePhase) private var scenePhase
    @State private var showNowPlaying = false
    @State private var pendingArtist: String?
    @State private var pendingAlbum: String?

    var body: some View {
        ZStack {
            // Frosted artwork background
            if let image = audioPlayer.artworkImage {
                GeometryReader { geo in
                    Image(uiImage: image)
                        .resizable()
                        .aspectRatio(contentMode: .fill)
                        .frame(width: geo.size.width, height: geo.size.height)
                        .clipped()
                        .blur(radius: 64)
                        .saturation(colorScheme == .dark ? 1.8 : 1.4)
                        .brightness(colorScheme == .dark ? 0.4 : 0.3)
                        .overlay(
                            colorScheme == .dark
                                ? Color.black.opacity(0.5)
                                : Color.white.opacity(0.8)
                        )
                }
                .ignoresSafeArea()
                .transition(.opacity)
            } else {
                Color(.systemBackground)
                    .ignoresSafeArea()
            }

            LibraryView(pendingArtist: $pendingArtist, pendingAlbum: $pendingAlbum)
                .safeAreaInset(edge: .bottom, spacing: 0) {
                    MiniPlayerBar(showNowPlaying: $showNowPlaying)
                }
                .fullScreenCover(isPresented: $showNowPlaying) {
                    NowPlayingView(pendingArtist: $pendingArtist, pendingAlbum: $pendingAlbum)
                }
        }
        .animation(.easeInOut(duration: 0.8), value: audioPlayer.artworkImage != nil)
        .tint(audioPlayer.accentColor ?? (colorScheme == .dark ? .white : .black))
        .overlay(alignment: .top) {
            if let state = handoffManager.remoteState, let track = handoffManager.remoteTrack {
                HandoffBannerView(state: state, track: track, player: audioPlayer, handoffManager: handoffManager)
                    .transition(.move(edge: .top).combined(with: .opacity))
                    .padding(.top, 60)
            }
        }
        .onChange(of: scenePhase) { _, newPhase in
            if newPhase == .active {
                Task { await handoffManager.pull() }
            }
        }
    }
}

// MARK: - Handoff Banner

private struct HandoffBannerView: View {
    let state: HandoffManager.HandoffState
    let track: Track
    let player: AudioPlayer
    let handoffManager: HandoffManager

    var body: some View {
        HStack(spacing: 12) {
            // Artwork
            if let hash = track.artworkHash {
                ArtworkImage(hash: hash, size: 44)
            } else {
                RoundedRectangle(cornerRadius: 8)
                    .fill(.ultraThinMaterial)
                    .frame(width: 44, height: 44)
                    .overlay {
                        Image(systemName: "music.note")
                            .foregroundStyle(.secondary)
                    }
            }

            // Info
            VStack(alignment: .leading, spacing: 2) {
                Text(track.title)
                    .font(.subheadline)
                    .fontWeight(.medium)
                    .lineLimit(1)
                if let artist = track.artist {
                    Text(artist)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                Text("Paused at \(formatTime(state.position)) on \(state.deviceName)")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }

            Spacer()

            // Actions
            Button {
                resumeFromHandoff()
            } label: {
                Text("Resume")
                    .font(.caption)
                    .fontWeight(.medium)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .background(.tint.opacity(0.15))
                    .clipShape(Capsule())
            }

            Button {
                handoffManager.dismiss()
            } label: {
                Image(systemName: "xmark")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(12)
        .background(.ultraThinMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .shadow(color: .black.opacity(0.2), radius: 10)
        .padding(.horizontal, 16)
    }

    private func resumeFromHandoff() {
        // Load all tracks and find this one to build a queue
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

// Simple artwork image for the banner
private struct ArtworkImage: View {
    let hash: String
    let size: CGFloat
    @State private var image: UIImage?

    var body: some View {
        Group {
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .aspectRatio(contentMode: .fill)
            } else {
                RoundedRectangle(cornerRadius: 8)
                    .fill(.ultraThinMaterial)
                    .overlay {
                        Image(systemName: "music.note")
                            .foregroundStyle(.secondary)
                    }
            }
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .task {
            // Load artwork from the shared artwork directory
            let appSupport = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
            let path = appSupport.appendingPathComponent("Artwork/\(hash).jpg")
            image = UIImage(contentsOfFile: path.path)
        }
    }
}
