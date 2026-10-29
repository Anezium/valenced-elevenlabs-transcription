package app.anezium.elevenlabs

import java.nio.ByteBuffer
import javax.crypto.Cipher
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Same JCE envelope for AndroidKeyStore and the desktop crypto tests. */
internal object Envelope {
    private val aad = "anezium.elevenlabs.vault.v1".toByteArray(Charsets.UTF_8)
    fun encrypt(value: String, key: SecretKey): ByteArray {
        require(value.matches(Regex("[A-Za-z0-9_-]{16,512}")))
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key); cipher.updateAAD(aad)
        check(cipher.iv.size == 12)
        val plain = value.toByteArray(Charsets.UTF_8)
        val encrypted = try { cipher.doFinal(plain) } finally { plain.fill(0) }
        return ByteBuffer.allocate(13 + encrypted.size).put(1.toByte()).put(cipher.iv).put(encrypted).array()
    }
    fun decrypt(bytes: ByteArray, key: SecretKey): String {
        check(bytes.size in 45..541 && bytes[0] == 1.toByte())
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, bytes.copyOfRange(1, 13)))
        cipher.updateAAD(aad)
        val plain = cipher.doFinal(bytes.copyOfRange(13, bytes.size))
        return try { String(plain, Charsets.UTF_8).also { check(it.matches(Regex("[A-Za-z0-9_-]{16,512}"))) } }
        finally { plain.fill(0) }
    }
}
