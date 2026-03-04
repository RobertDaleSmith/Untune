import SwiftUI

struct PairingView: View {
    @Environment(PairingManager.self) private var pairingManager
    @Environment(DesktopDiscovery.self) private var discovery
    @Environment(\.dismiss) private var dismiss

    @State private var pairingCode = ""
    @State private var selectedDesktop: DesktopDiscovery.DiscoveredDesktop?
    @State private var isPairing = false
    @State private var errorMessage: String?
    @State private var showManualEntry = false
    @State private var manualHost = ""
    @State private var manualPort = "8485"
    @FocusState private var focusedField: Field?

    enum Field { case host, code }

    private var canPair: Bool {
        pairingCode.count == 4 && !isPairing &&
        (selectedDesktop != nil || (showManualEntry && !manualHost.isEmpty))
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 24) {
                    // Instructions
                    VStack(spacing: 8) {
                        Image(systemName: "desktopcomputer")
                            .font(.system(size: 48))
                            .foregroundStyle(.secondary)
                        Text("Pair with Desktop")
                            .font(.title2.bold())
                        Text("Make sure Untune is running on your Mac and both devices are on the same Wi-Fi network.")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal)
                    }
                    .padding(.top, 20)

                    if showManualEntry {
                        manualEntrySection
                    } else {
                        discoverySection
                    }

                    // Pairing code input
                    if selectedDesktop != nil || showManualEntry {
                        VStack(spacing: 8) {
                            Text("Enter the 4-digit code shown on your desktop")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)

                            TextField("0000", text: $pairingCode)
                                .keyboardType(.numberPad)
                                .multilineTextAlignment(.center)
                                .font(.system(size: 32, weight: .bold, design: .monospaced))
                                .frame(width: 160)
                                .textFieldStyle(.roundedBorder)
                                .focused($focusedField, equals: .code)
                                .onChange(of: pairingCode) { _, newValue in
                                    // Limit to 4 digits
                                    if newValue.count > 4 {
                                        pairingCode = String(newValue.prefix(4))
                                    }
                                }
                        }
                    }

                    // Error
                    if let errorMessage {
                        Text(errorMessage)
                            .font(.caption)
                            .foregroundStyle(.red)
                    }

                    // Pair button
                    if selectedDesktop != nil || (showManualEntry && !manualHost.isEmpty) {
                        Button {
                            focusedField = nil
                            Task { await pairWithDesktop() }
                        } label: {
                            if isPairing {
                                ProgressView()
                                    .frame(maxWidth: .infinity)
                            } else {
                                Text("Pair")
                                    .frame(maxWidth: .infinity)
                            }
                        }
                        .buttonStyle(.borderedProminent)
                        .controlSize(.large)
                        .disabled(!canPair)
                        .padding(.horizontal)
                    }
                }
                .padding(.bottom, 40)
            }
            .scrollDismissesKeyboard(.interactively)
            .onTapGesture { focusedField = nil }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .keyboard) {
                    Button("Done") { focusedField = nil }
                        .frame(maxWidth: .infinity, alignment: .trailing)
                }
            }
            .onAppear {
                discovery.startSearching()
            }
            .onDisappear {
                discovery.stopSearching()
            }
        }
    }

    // MARK: - Discovery Section

    @ViewBuilder
    private var discoverySection: some View {
        if discovery.discoveredDesktops.isEmpty {
            if discovery.isSearching {
                VStack(spacing: 12) {
                    ProgressView()
                    Text("Searching for desktops...")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 24)
            } else {
                Text("No desktops found")
                    .foregroundStyle(.secondary)
                    .padding(.vertical, 24)
            }

            Button("Enter IP Address Manually") {
                showManualEntry = true
            }
            .font(.subheadline)
        } else {
            VStack(alignment: .leading, spacing: 8) {
                Text("Available Desktops")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal)

                ForEach(discovery.discoveredDesktops) { desktop in
                    Button {
                        selectedDesktop = desktop
                    } label: {
                        HStack {
                            Image(systemName: "desktopcomputer")
                            Text(desktop.name)
                            Spacer()
                            if selectedDesktop?.id == desktop.id {
                                Image(systemName: "checkmark.circle.fill")
                                    .foregroundStyle(Color.accentColor)
                            }
                        }
                        .padding(.horizontal)
                        .padding(.vertical, 12)
                        .background(
                            selectedDesktop?.id == desktop.id
                                ? Color.accentColor.opacity(0.1)
                                : Color(.secondarySystemGroupedBackground)
                        )
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                    }
                    .buttonStyle(.plain)
                    .padding(.horizontal)
                }
            }
        }
    }

    // MARK: - Manual Entry Section

    private var manualEntrySection: some View {
        VStack(spacing: 12) {
            Text("Desktop IP Address")
                .font(.caption)
                .foregroundStyle(.secondary)

            TextField("192.168.1.100", text: $manualHost)
                .keyboardType(.decimalPad)
                .multilineTextAlignment(.center)
                .textFieldStyle(.roundedBorder)
                .frame(width: 200)
                .focused($focusedField, equals: .host)

            Button("Back to Auto-Discovery") {
                showManualEntry = false
            }
            .font(.caption)
        }
    }

    // MARK: - Pairing

    private func pairWithDesktop() async {
        isPairing = true
        errorMessage = nil

        if showManualEntry {
            let port = UInt16(manualPort) ?? 8485
            do {
                try await pairingManager.pair(host: manualHost, port: port, code: pairingCode)
                await MainActor.run { dismiss() }
            } catch {
                await MainActor.run {
                    errorMessage = error.localizedDescription
                    isPairing = false
                }
            }
        } else if let desktop = selectedDesktop {
            discovery.resolve(desktop) { host, port in
                Task {
                    do {
                        try await pairingManager.pair(host: host, port: port, code: pairingCode)
                        await MainActor.run { dismiss() }
                    } catch {
                        await MainActor.run {
                            errorMessage = error.localizedDescription
                            isPairing = false
                        }
                    }
                }
            }
        }
    }
}
