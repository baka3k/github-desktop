import { TokenStore } from '../stores/token-store'

const TokenStoreKey = `${
  __DEV__ ? 'GitHub Desktop Dev' : 'GitHub Desktop'
} - AI Summary Provider`

export function getAISummaryProviderSecret(
  providerId: string
): Promise<string | null> {
  return TokenStore.getItem(TokenStoreKey, providerId)
}

export function setAISummaryProviderSecret(
  providerId: string,
  secret: string
): Promise<void> {
  return TokenStore.setItem(TokenStoreKey, providerId, secret)
}

export function deleteAISummaryProviderSecret(
  providerId: string
): Promise<boolean> {
  return TokenStore.deleteItem(TokenStoreKey, providerId)
}

export const AIProviderTokenStoreKey = TokenStoreKey
