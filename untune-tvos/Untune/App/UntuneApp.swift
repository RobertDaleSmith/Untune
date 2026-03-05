import SwiftUI
import AVFoundation

@main
struct UntuneApp: App {
    @State private var audioPlayer = AudioPlayer.shared
    @State private var databaseManager = DatabaseManager.shared
    @State private var pairingManager = PairingManager()
    @State private var discovery = DesktopDiscovery()
    @State private var syncEngine: SyncEngine

    init() {
        let pairing = PairingManager()
        _pairingManager = State(initialValue: pairing)
        _syncEngine = State(initialValue: SyncEngine(pairingManager: pairing))
        configureAudioSession()
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(audioPlayer)
                .environment(pairingManager)
                .environment(discovery)
                .environment(syncEngine)
                .onAppear {
                    databaseManager.seedMockDataIfEmpty()
                    audioPlayer.restoreLastSession()

                    // Connect streaming URLs to pairing info
                    if pairingManager.isPaired {
                        audioPlayer.streamBaseURL = pairingManager.baseURL
                        audioPlayer.streamAuthToken = pairingManager.authToken()

                        // Auto-sync metadata on launch if paired
                        Task {
                            await syncEngine.sync()
                        }
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
