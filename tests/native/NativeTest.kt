package app.anezium.elevenlabs

import app.valenced.bridge.ValencedBridge
import app.valenced.plugins.PluginBuilder
import app.valenced.plugins.PluginManifest
import app.valenced.plugins.PluginScope
import app.valenced.plugins.Version
import java.lang.reflect.Proxy
import kotlinx.coroutines.runBlocking
import javax.crypto.KeyGenerator

// JVM tests use real AES-GCM and real pinned host classes, NOT AndroidKeyStore.
fun main() = runBlocking {
    var assertions = 0
    fun verify(value: Boolean) { check(value); assertions++ }
    val key = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
    val wrong = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
    for (value in listOf("synthetic_fixture_key_000000", "a".repeat(16), "b".repeat(512))) {
        val a = Envelope.encrypt(value, key); val b = Envelope.encrypt(value, key)
        verify(Envelope.decrypt(a, key) == value)
        verify(!a.contentEquals(b))
        verify(!String(a, Charsets.ISO_8859_1).contains(value))
        verify(runCatching { Envelope.decrypt(a, wrong) }.isFailure)
        for (index in listOf(0, 1, 12, 13, a.lastIndex)) {
            val broken = a.copyOf(); broken[index] = (broken[index].toInt() xor 1).toByte()
            verify(runCatching { Envelope.decrypt(broken, key) }.isFailure)
        }
        verify(runCatching { Envelope.decrypt(a.copyOf(a.size-1), key) }.isFailure)
    }
    verify(runCatching { Envelope.encrypt("invalid", key) }.isFailure)
    verify(runCatching { Envelope.decrypt(ByteArray(542), key) }.isFailure)
    val handlers = mutableMapOf<String, suspend (List<Any?>) -> Any?>()
    val bridge = object : ValencedBridge {
        override val isReady = true
        override fun registerMethod(name: String, handler: (List<Any?>) -> Any?) { error("must use async") }
        override fun registerAsyncMethod(name: String, handler: suspend (List<Any?>) -> Any?) { handlers[name] = handler }
        override suspend fun callJSMethod(name: String, args: List<Any?>): Any? = error("unexpected JS")
    }
    // Context intentionally absent: verifies lifecycle/failure protocol, not device behavior.
    val scope = Proxy.newProxyInstance(PluginScope::class.java.classLoader, arrayOf(PluginScope::class.java)) { _, method, _ ->
        when (method.name) { "getBridge" -> bridge; "withAppContext" -> kotlin.Unit; else -> error("unexpected ${method.name}") }
    } as PluginScope
    val facade = Class.forName("app.anezium.elevenlabs.ElevenLabsPlugin")
    val getter = facade.declaredMethods.single { java.lang.reflect.Modifier.isStatic(it.modifiers) && it.parameterCount == 0 && PluginBuilder::class.java.isAssignableFrom(it.returnType) }
    val builder = getter.invoke(null) as PluginBuilder
    val plugin = builder.build(PluginManifest("anezium.elevenlabs-transcription", "Test", "", "", version=Version.parse("0.2.0-dev")))
    plugin.start(scope)
    verify(handlers.keys == setOf("load", "save", "delete").map { "anezium.elevenlabs.vault.$it" }.toSet() + "anezium.elevenlabs.auto.reserve")
    for (handler in handlers.values) verify(handler(emptyList()) == mapOf("ok" to false))
    plugin.stop(scope)
    for (handler in handlers.values) verify(handler(listOf("synthetic_fixture_key_000000")) == mapOf("ok" to false))
    println("Native JVM crypto, host builder and async bridge lifecycle: $assertions assertions PASS. AndroidKeyStore NOT executed.")
}
