import SwiftUI

struct ContentView: View {
    @Environment(AudioPlayer.self) private var audioPlayer
    @Environment(\.colorScheme) private var colorScheme
    @State private var showNowPlaying = false

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
                        .saturation(1.8)
                        .brightness(colorScheme == .dark ? 0.4 : 0.0)
                        .overlay(
                            colorScheme == .dark
                                ? Color.black.opacity(0.5)
                                : Color.white.opacity(0.65)
                        )
                }
                .ignoresSafeArea()
                .transition(.opacity)
            } else {
                Color(.systemBackground)
                    .ignoresSafeArea()
            }

            LibraryView()
                .safeAreaInset(edge: .bottom, spacing: 0) {
                    MiniPlayerBar(showNowPlaying: $showNowPlaying)
                }
                .fullScreenCover(isPresented: $showNowPlaying) {
                    NowPlayingView()
                }
        }
        .animation(.easeInOut(duration: 0.8), value: audioPlayer.artworkImage != nil)
        .tint(audioPlayer.accentColor ?? .white)
    }
}
