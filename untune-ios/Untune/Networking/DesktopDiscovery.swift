import Foundation
import Network

@Observable
class DesktopDiscovery {
    private var browser: NWBrowser?
    private(set) var discoveredDesktops: [DiscoveredDesktop] = []
    private(set) var isSearching = false

    struct DiscoveredDesktop: Identifiable, Hashable {
        let id: String
        let name: String
        let host: String
        let port: UInt16
    }

    func startSearching() {
        guard !isSearching else { return }
        isSearching = true
        discoveredDesktops = []

        let params = NWParameters()
        params.includePeerToPeer = true

        browser = NWBrowser(for: .bonjour(type: "_untune._tcp", domain: nil), using: params)

        browser?.stateUpdateHandler = { [weak self] state in
            switch state {
            case .ready:
                print("Bonjour browser ready")
            case .failed(let error):
                print("Bonjour browser unavailable: \(error) — use manual IP entry")
                DispatchQueue.main.async {
                    self?.isSearching = false
                }
            default:
                break
            }
        }

        browser?.browseResultsChangedHandler = { [weak self] results, changes in
            DispatchQueue.main.async {
                self?.discoveredDesktops = results.compactMap { result in
                    switch result.endpoint {
                    case .service(let name, _, _, _):
                        return DiscoveredDesktop(
                            id: name,
                            name: name,
                            host: name,
                            port: 8485
                        )
                    default:
                        return nil
                    }
                }
            }
        }

        browser?.start(queue: .main)
    }

    func stopSearching() {
        browser?.cancel()
        browser = nil
        isSearching = false
    }

    /// Resolve a Bonjour service to get its IPv4 address and port
    func resolve(_ desktop: DiscoveredDesktop, completion: @escaping (String, UInt16) -> Void) {
        let endpoint = NWEndpoint.service(
            name: desktop.name,
            type: "_untune._tcp",
            domain: "local.",
            interface: nil
        )

        // Force IPv4 to avoid link-local IPv6 issues
        let params = NWParameters.tcp
        if let ipOptions = params.defaultProtocolStack.internetProtocol as? NWProtocolIP.Options {
            ipOptions.version = .v4
        }

        let connection = NWConnection(to: endpoint, using: params)

        connection.stateUpdateHandler = { state in
            switch state {
            case .ready:
                if let innerEndpoint = connection.currentPath?.remoteEndpoint,
                   case .hostPort(let host, let port) = innerEndpoint {
                    let hostStr: String
                    switch host {
                    case .ipv4(let addr):
                        hostStr = "\(addr)"
                    case .name(let name, _):
                        hostStr = name
                    default:
                        hostStr = "\(host)"
                    }
                    print("Resolved \(desktop.name) to \(hostStr):\(port.rawValue)")
                    connection.cancel()
                    DispatchQueue.main.async {
                        completion(hostStr, port.rawValue)
                    }
                }
            case .failed(let error):
                print("Failed to resolve \(desktop.name): \(error)")
                connection.cancel()
            default:
                break
            }
        }

        connection.start(queue: .global())
    }
}
