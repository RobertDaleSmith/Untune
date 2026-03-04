import SwiftUI
import AVFoundation

@main
struct UntuneApp: App {
    @State private var audioPlayer = AudioPlayer()
    @State private var databaseManager = DatabaseManager.shared
    @State private var pairingManager = PairingManager()
    @State private var discovery = DesktopDiscovery()
    @State private var syncEngine: SyncEngine

    init() {
        let pairing = PairingManager()
        _pairingManager = State(initialValue: pairing)
        _syncEngine = State(initialValue: SyncEngine(pairingManager: pairing))
        configureAudioSession()
        configureTransparentNavigation()
    }

    private func configureTransparentNavigation() {
        // Make NavigationStack background transparent so frosted artwork shows through
        let navAppearance = UINavigationBarAppearance()
        navAppearance.configureWithTransparentBackground()
        UINavigationBar.appearance().standardAppearance = navAppearance
        UINavigationBar.appearance().scrollEdgeAppearance = navAppearance

        // Clear default backgrounds for collection/table views used by SwiftUI Lists
        UICollectionView.appearance().backgroundColor = .clear
        UITableView.appearance().backgroundColor = .clear
    }

    var body: some Scene {
        WindowGroup {
            SplashView {
                ContentView()
                    .environment(audioPlayer)
                    .environment(pairingManager)
                    .environment(discovery)
                    .environment(syncEngine)
                    .onAppear {
                        databaseManager.seedMockDataIfEmpty()
                        audioPlayer.restoreLastSession()
                    }
            }
        }
    }

    private func configureAudioSession() {
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback, mode: .default, options: [])
            try session.setActive(true)
        } catch {
            print("Failed to configure audio session: \(error)")
        }
    }
}
