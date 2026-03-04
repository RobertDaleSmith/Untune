import SwiftUI
import AVFoundation
import Intents
import UIKit

enum AppearanceMode: String, CaseIterable {
    case system, light, dark

    var colorScheme: ColorScheme? {
        switch self {
        case .system: return nil
        case .light: return .light
        case .dark: return .dark
        }
    }

    var label: String {
        switch self {
        case .system: return "System"
        case .light: return "Light"
        case .dark: return "Dark"
        }
    }
}

@main
struct UntuneApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) var appDelegate
    @AppStorage("appearanceMode") private var appearanceMode: AppearanceMode = .system
    @State private var audioPlayer = AudioPlayer.shared
    @State private var databaseManager = DatabaseManager.shared
    @State private var pairingManager = PairingManager()
    @State private var discovery = DesktopDiscovery()
    @State private var syncEngine: SyncEngine

    init() {
        let pairing = PairingManager()
        _pairingManager = State(initialValue: pairing)
        _syncEngine = State(initialValue: SyncEngine(pairingManager: pairing))
        SyncEngine.registerBackgroundSync()
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
            .preferredColorScheme(appearanceMode.colorScheme)
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

// MARK: - AppDelegate (CarPlay scene routing)

class AppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        configurationForConnecting connectingSceneSession: UISceneSession,
        options: UIScene.ConnectionOptions
    ) -> UISceneConfiguration {
        if connectingSceneSession.role == .carTemplateApplication {
            let config = UISceneConfiguration(name: "CarPlay", sessionRole: .carTemplateApplication)
            config.delegateClass = CarPlaySceneDelegate.self
            return config
        }
        return UISceneConfiguration(name: "Phone", sessionRole: connectingSceneSession.role)
    }

    func application(_ application: UIApplication, supportedInterfaceOrientationsFor window: UIWindow?) -> UIInterfaceOrientationMask {
        return [.portrait, .portraitUpsideDown]
    }

    func application(_ application: UIApplication, handlerFor intent: INIntent) -> Any? {
        if intent is INPlayMediaIntent {
            return PlayMediaIntentHandler()
        }
        return nil
    }
}
