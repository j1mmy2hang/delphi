import Foundation
import StoreKit
import Observation

/// StoreKit 2 wrapper for the single "Delphi Plus" auto-renewable subscription.
/// StoreKit verifies the purchase and entitlement on-device; the app sends
/// `X-Tier: paid` to the backend only while `isSubscribed` is true.
///
/// Product ID must match App Store Connect (and `Delphi.storekit` for local
/// testing). See docs/app-store-submission.md §3c.
@MainActor
@Observable
final class SubscriptionStore {
    static let productID = "com.jimmyzhang.delphi.plus.monthly"

    private(set) var product: Product?
    private(set) var isSubscribed = false
    private(set) var purchasing = false

    @ObservationIgnored private var updatesTask: Task<Void, Never>?

    init() {
        updatesTask = listenForTransactions()
        Task { await loadProduct(); await refreshEntitlement() }
    }

    func loadProduct() async {
        product = try? await Product.products(for: [Self.productID]).first
    }

    /// Active if there's a verified, non-revoked entitlement for the product.
    func refreshEntitlement() async {
        var active = false
        for await result in Transaction.currentEntitlements {
            if case .verified(let transaction) = result,
               transaction.productID == Self.productID,
               transaction.revocationDate == nil {
                active = true
            }
        }
        isSubscribed = active
    }

    /// Present Apple's purchase sheet. Returns true if subscribed afterward.
    @discardableResult
    func purchase() async -> Bool {
        if product == nil { await loadProduct() }
        guard let product else { return false }
        purchasing = true
        defer { purchasing = false }
        do {
            switch try await product.purchase() {
            case .success(let verification):
                if case .verified(let transaction) = verification {
                    await transaction.finish()
                }
                await refreshEntitlement()
                return isSubscribed
            case .userCancelled, .pending:
                return false
            @unknown default:
                return false
            }
        } catch {
            return false
        }
    }

    /// Restore purchases (App Store sync), then re-check the entitlement.
    func restore() async {
        try? await AppStore.sync()
        await refreshEntitlement()
    }

    private func listenForTransactions() -> Task<Void, Never> {
        Task { [weak self] in
            for await result in Transaction.updates {
                if case .verified(let transaction) = result {
                    await transaction.finish()
                }
                await self?.refreshEntitlement()
            }
        }
    }
}
