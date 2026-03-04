import Foundation
import Security
import UIKit

@Observable
class PairingManager {
    private(set) var isPaired = false
    private(set) var desktopName: String?
    private(set) var deviceId: String?
    private(set) var baseURL: String?

    struct PairResponse: Codable {
        let deviceId: String
        let pairingToken: String
        let desktopName: String
    }

    init() {
        loadFromKeychain()
    }

    func pair(host: String, port: UInt16, code: String) async throws {
        // Clear any previous pairing first
        deleteFromKeychain()

        // Clean up host: strip IPv6 scope ID (e.g. %en0) and bracket if needed
        var cleanHost = host
        if let pctIdx = cleanHost.firstIndex(of: "%") {
            cleanHost = String(cleanHost[..<pctIdx])
        }
        let urlHost = cleanHost.contains(":") ? "[\(cleanHost)]" : cleanHost
        let urlString = "http://\(urlHost):\(port)/api/pair"
        print("Pairing URL: \(urlString)")
        guard let url = URL(string: urlString) else {
            throw PairingError.invalidResponse
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let deviceName = await UIDevice.current.name
        let body: [String: String] = ["code": code, "deviceName": deviceName]
        request.httpBody = try JSONEncoder().encode(body)

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw PairingError.invalidResponse
        }

        switch httpResponse.statusCode {
        case 200:
            let decoder = JSONDecoder()
            let pairResponse = try decoder.decode(PairResponse.self, from: data)
            let base = "http://\(urlHost):\(port)"
            print("Paired with desktop at \(base)")
            saveToKeychain(
                token: pairResponse.pairingToken,
                deviceId: pairResponse.deviceId,
                desktopName: pairResponse.desktopName,
                baseURL: base
            )
            self.isPaired = true
            self.deviceId = pairResponse.deviceId
            self.desktopName = pairResponse.desktopName
            self.baseURL = base
        case 403:
            throw PairingError.invalidCode
        default:
            throw PairingError.serverError(httpResponse.statusCode)
        }
    }

    func unpair() {
        deleteFromKeychain()
        isPaired = false
        deviceId = nil
        desktopName = nil
        baseURL = nil
    }

    func authToken() -> String? {
        readKeychainValue(key: "com.untune.ios.pairing-token")
    }

    // MARK: - Keychain

    private func saveToKeychain(token: String, deviceId: String, desktopName: String, baseURL: String) {
        setKeychainValue(key: "com.untune.ios.pairing-token", value: token)
        setKeychainValue(key: "com.untune.ios.device-id", value: deviceId)
        setKeychainValue(key: "com.untune.ios.desktop-name", value: desktopName)
        setKeychainValue(key: "com.untune.ios.base-url", value: baseURL)
    }

    private func loadFromKeychain() {
        if let token = readKeychainValue(key: "com.untune.ios.pairing-token"),
           let devId = readKeychainValue(key: "com.untune.ios.device-id"),
           let name = readKeychainValue(key: "com.untune.ios.desktop-name"),
           let url = readKeychainValue(key: "com.untune.ios.base-url"),
           !token.isEmpty {
            // Reject broken IPv6 link-local URLs that can't be reached
            if url.contains("fe80") {
                print("Clearing broken IPv6 link-local pairing")
                deleteFromKeychain()
                return
            }
            isPaired = true
            deviceId = devId
            desktopName = name
            baseURL = url
        }
    }

    private func deleteFromKeychain() {
        deleteKeychainValue(key: "com.untune.ios.pairing-token")
        deleteKeychainValue(key: "com.untune.ios.device-id")
        deleteKeychainValue(key: "com.untune.ios.desktop-name")
        deleteKeychainValue(key: "com.untune.ios.base-url")
    }

    private func setKeychainValue(key: String, value: String) {
        let data = value.data(using: .utf8)!
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key,
        ]
        SecItemDelete(query as CFDictionary)
        let addQuery: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key,
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock,
        ]
        SecItemAdd(addQuery as CFDictionary, nil)
    }

    private func readKeychainValue(key: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
        ]
        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess, let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    private func deleteKeychainValue(key: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key,
        ]
        SecItemDelete(query as CFDictionary)
    }
}

enum PairingError: LocalizedError {
    case invalidCode
    case invalidResponse
    case serverError(Int)

    var errorDescription: String? {
        switch self {
        case .invalidCode: return "Invalid pairing code"
        case .invalidResponse: return "Invalid response from desktop"
        case .serverError(let code): return "Server error (\(code))"
        }
    }
}
