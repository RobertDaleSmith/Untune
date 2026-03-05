import SwiftUI

struct PairingView: View {
    @Environment(PairingManager.self) private var pairingManager
    @Environment(DesktopDiscovery.self) private var discovery

    @State private var pairingCode = ""
    @State private var manualHost = ""
    @State private var manualPort = "8485"
    @State private var isPairing = false
    @State private var errorMessage: String?
    @State private var showManualEntry = false

    var body: some View {
        VStack(spacing: 40) {
            Text("Connect to Desktop")
                .font(.title2)

            if !showManualEntry {
                // Bonjour discovery
                VStack(spacing: 20) {
                    if discovery.isSearching && discovery.discoveredDesktops.isEmpty {
                        VStack(spacing: 16) {
                            ProgressView()
                            Text("Searching for Untune on your network...")
                                .font(.body)
                                .foregroundStyle(.secondary)
                        }
                    }

                    ForEach(discovery.discoveredDesktops) { desktop in
                        Button {
                            resolveAndShowCodeEntry(desktop)
                        } label: {
                            HStack {
                                Image(systemName: "desktopcomputer")
                                    .font(.title2)
                                Text(desktop.name)
                                    .font(.body)
                                Spacer()
                                Image(systemName: "chevron.right")
                                    .foregroundStyle(.secondary)
                            }
                            .padding()
                            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 12))
                        }
                        .buttonStyle(.plain)
                    }

                    Button("Enter IP Address Manually") {
                        showManualEntry = true
                    }
                    .padding(.top, 20)
                }
            } else {
                // Manual IP entry
                VStack(spacing: 20) {
                    TextField("IP Address", text: $manualHost)
                        .textContentType(.URL)

                    TextField("Port", text: $manualPort)
                        .keyboardType(.numberPad)
                }
                .frame(maxWidth: 500)
            }

            // Pairing code entry
            if !manualHost.isEmpty || showManualEntry {
                VStack(spacing: 16) {
                    Text("Enter the 4-digit code shown on your desktop")
                        .font(.body)
                        .foregroundStyle(.secondary)

                    TextField("Pairing Code", text: $pairingCode)
                        .keyboardType(.numberPad)
                        .multilineTextAlignment(.center)
                        .frame(maxWidth: 300)

                    if let errorMessage {
                        Text(errorMessage)
                            .font(.subheadline)
                            .foregroundStyle(.red)
                    }

                    Button {
                        Task { await pair() }
                    } label: {
                        if isPairing {
                            ProgressView()
                        } else {
                            Text("Connect")
                        }
                    }
                    .disabled(pairingCode.count != 4 || isPairing)
                }
            }

            Spacer()
        }
        .padding(60)
        .onAppear {
            discovery.startSearching()
        }
        .onDisappear {
            discovery.stopSearching()
        }
    }

    private func resolveAndShowCodeEntry(_ desktop: DesktopDiscovery.DiscoveredDesktop) {
        discovery.resolve(desktop) { host, port in
            manualHost = host
            manualPort = "\(port)"
        }
    }

    private func pair() async {
        guard let port = UInt16(manualPort) else {
            errorMessage = "Invalid port"
            return
        }

        isPairing = true
        errorMessage = nil

        do {
            try await pairingManager.pair(host: manualHost, port: port, code: pairingCode)
        } catch {
            errorMessage = error.localizedDescription
        }

        isPairing = false
    }
}
