import Foundation
import UIKit

@Observable
class HandoffManager {
    static let shared = HandoffManager()

    var remoteState: HandoffState?
    var remoteTrack: Track?

    private let defaults = UserDefaults.standard

    private enum Keys {
        static let url = "handoff.url"
        static let token = "handoff.token"
    }

    var url: String {
        get { defaults.string(forKey: Keys.url) ?? "" }
        set { defaults.set(newValue, forKey: Keys.url) }
    }

    var token: String {
        get { defaults.string(forKey: Keys.token) ?? "" }
        set { defaults.set(newValue, forKey: Keys.token) }
    }

    var isConfigured: Bool {
        !url.isEmpty && !token.isEmpty
    }

    // MARK: - State Payload

    struct HandoffState: Codable {
        let trackPersistentId: String
        let position: Double
        let queueSource: String?
        let shuffle: Bool
        let repeatMode: String
        let updatedAt: Int
        let deviceName: String
    }

    // MARK: - Push

    func push(player: AudioPlayer) async {
        let snapshot = await MainActor.run { () -> (String, Double, Bool, String)? in
            guard isConfigured,
                  let track = player.currentTrack,
                  let persistentId = track.persistentId else { return nil }
            return (persistentId, player.position, player.shuffle, player.repeatMode.rawValue)
        }
        guard let (persistentId, position, shuffle, repeatMode) = snapshot else { return }

        let deviceName = await UIDevice.current.name
        let state = HandoffState(
            trackPersistentId: persistentId,
            position: position,
            queueSource: nil,
            shuffle: shuffle,
            repeatMode: repeatMode,
            updatedAt: Int(Date().timeIntervalSince1970),
            deviceName: deviceName
        )

        let endpoint = "\(url.trimmingCharacters(in: CharacterSet(charactersIn: "/")))/api/state/\(token)"
        guard let requestURL = URL(string: endpoint) else { return }

        var request = URLRequest(url: requestURL)
        request.httpMethod = "PUT"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 5

        do {
            request.httpBody = try JSONEncoder().encode(state)
            let (_, response) = try await URLSession.shared.data(for: request)
            if let http = response as? HTTPURLResponse, http.statusCode == 200 {
                print("[Handoff] Push OK")
            }
        } catch {
            print("[Handoff] Push failed: \(error)")
        }
    }

    // MARK: - Pull

    func pull() async {
        guard isConfigured else { return }

        let endpoint = "\(url.trimmingCharacters(in: CharacterSet(charactersIn: "/")))/api/state/\(token)"
        guard let requestURL = URL(string: endpoint) else { return }

        var request = URLRequest(url: requestURL)
        request.httpMethod = "GET"
        request.timeoutInterval = 5

        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse else { return }

            if http.statusCode == 404 {
                await MainActor.run { remoteState = nil; remoteTrack = nil }
                return
            }

            guard http.statusCode == 200 else { return }

            let state = try JSONDecoder().decode(HandoffState.self, from: data)

            // Ignore state pushed by this device
            let thisDevice = await UIDevice.current.name
            if state.deviceName == thisDevice {
                print("[Handoff] Ignoring own state from \(thisDevice)")
                return
            }

            // Resolve track locally
            let track = try? DatabaseManager.shared.fetchTrackByPersistentId(state.trackPersistentId)

            await MainActor.run {
                self.remoteState = state
                self.remoteTrack = track
            }
            print("[Handoff] Pull OK: \(state.deviceName) @ \(state.position)s")
        } catch {
            print("[Handoff] Pull failed: \(error)")
        }
    }

    // MARK: - Dismiss

    func dismiss() {
        remoteState = nil
        remoteTrack = nil
    }
}
