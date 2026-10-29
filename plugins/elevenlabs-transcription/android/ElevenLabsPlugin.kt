@file:JvmName("ElevenLabsPlugin")
package app.anezium.elevenlabs

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import app.valenced.plugins.plugin
import app.valenced.xposed.api.registerNativeAsyncMethod
import java.io.File
import java.security.KeyStore
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey

/** No plaintext storage, hardcoded key, backup, or logging of bridge arguments/errors. */
internal class Vault(context: Context) {
    private val file = AtomicFile(File(context.noBackupFilesDir, "anezium-elevenlabs-vault.v1"))
    private val alias = "anezium.elevenlabs.api.v1"

    private fun store() = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    private fun key(create: Boolean): SecretKey {
        val ks = store()
        if (ks.containsAlias(alias)) return ks.getKey(alias, null) as SecretKey
        check(create) { "vault unavailable" }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true).setKeySize(256).build())
        }.generateKey()
    }
    @Synchronized fun load(): String? {
        if (!file.baseFile.exists() && !File(file.baseFile.path + ".bak").exists()) return null
        val bytes = file.openRead().use { input ->
            val buffer = ByteArray(542)
            var count = 0
            while (count < buffer.size) {
                val n = input.read(buffer, count, buffer.size - count)
                if (n < 0) break
                if (n == 0) error("vault read failed")
                count += n
            }
            buffer.copyOf(count)
        }
        return Envelope.decrypt(bytes, key(false))
    }
    @Synchronized fun save(value: String) {
        require(value.matches(Regex("[A-Za-z0-9_-]{16,512}")))
        val payload = Envelope.encrypt(value, key(true))
        val output = file.startWrite()
        try { output.write(payload); file.finishWrite(output); check(load() == value) }
        catch (e: Throwable) { file.failWrite(output); throw e }
    }
    @Synchronized fun delete() {
        file.delete()
        check(!file.baseFile.exists() && !File(file.baseFile.path + ".bak").exists() && !File(file.baseFile.path + ".new").exists())
        store().apply { deleteEntry(alias); check(!containsAlias(alias)) }
    }
}

val elevenLabsPlugin = plugin {
    val lock = Any()
    var vault: Vault? = null
    var reservations: Reservations? = null
    var enabled = false
    start {
        synchronized(lock) { enabled = true }
        withAppContext { context -> synchronized(lock) {
            if (enabled) { vault = Vault(context); reservations = Reservations(context) }
        } }
        registerNativeAsyncMethod("anezium.elevenlabs.auto.reserve") { args ->
            synchronized(lock) {
                try {
                    check(enabled); require(args.size == 1)
                    mapOf("ok" to true, "reserved" to checkNotNull(reservations).reserve(args[0] as String))
                } catch (_: Throwable) { mapOf("ok" to false) }
            }
        }
        for (op in listOf("load", "save", "delete")) {
            registerNativeAsyncMethod("anezium.elevenlabs.vault.$op") { args ->
                synchronized(lock) {
                    try {
                        check(enabled)
                        val current = checkNotNull(vault)
                        when (op) {
                            "load" -> { require(args.isEmpty()); mapOf("ok" to true, "key" to current.load()) }
                            "save" -> { require(args.size == 1); current.save(args[0] as String); mapOf("ok" to true) }
                            else -> { require(args.isEmpty()); current.delete(); mapOf("ok" to true) }
                        }
                    } catch (_: Throwable) { mapOf("ok" to false) }
                }
            }
        }
    }
    stop { synchronized(lock) { enabled = false; vault = null; reservations = null } }
}
