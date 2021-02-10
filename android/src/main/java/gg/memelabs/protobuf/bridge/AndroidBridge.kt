package org.memelabs.protobuf.bridge

interface AndroidBridge {
    var onData: (b: ByteArray?) -> Unit
    fun write(b: ByteArray)
    fun emitError(msg: String?)
    fun emitData(b: ByteArray?)
}
