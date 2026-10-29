package app.anezium.elevenlabs

import android.content.Context
import android.util.AtomicFile
import java.io.File
import java.security.MessageDigest

/** Only hashes of account/channel/message identities; no audio, URL, transcript or key. */
internal class Reservations(context: Context) {
    private val file = AtomicFile(File(context.noBackupFilesDir, "anezium-elevenlabs-reservations.v1"))
    @Synchronized fun reserve(identity: String): Boolean {
        require(identity.matches(Regex("[0-9]{1,22}/[0-9]{1,22}/[0-9]{1,22}")))
        val hash = MessageDigest.getInstance("SHA-256").digest(identity.toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it) }
        val previous = if (!file.baseFile.exists() && !File(file.baseFile.path + ".bak").exists()) emptyList()
            else file.openRead().bufferedReader(Charsets.US_ASCII).use { input ->
                val entries = ArrayList<String>()
                while (true) {
                    // readLine is bounded by the file-size check, including corrupt inputs.
                    check(file.baseFile.length() <= 66560L)
                    val line = input.readLine() ?: break
                    check(line.matches(Regex("[a-f0-9]{64}")))
                    entries.add(line); check(entries.size <= 1024)
                }
                entries
            }
        if (hash in previous) return false
        // Fail closed at saturation; no eviction which could re-publish an old vocal.
        check(previous.size < 1024)
        val output = file.startWrite()
        try {
            val contents = previous.plus(hash).joinToString("\n") + "\n"
            output.write(contents.toByteArray(Charsets.US_ASCII))
            file.finishWrite(output)
            check(file.openRead().bufferedReader(Charsets.US_ASCII).use { it.readText() } == contents)
        } catch (e: Throwable) { file.failWrite(output); throw e }
        return true
    }
}
