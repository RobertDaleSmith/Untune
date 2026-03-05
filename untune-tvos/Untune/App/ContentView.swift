import SwiftUI

struct ContentView: View {
    @Environment(AudioPlayer.self) private var audioPlayer
    @Environment(PairingManager.self) private var pairingManager

    var body: some View {
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
    }
}
