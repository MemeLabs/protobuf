// Code generated by Wire protocol buffer compiler, do not edit.
// Source: strims.rpc.Close in rpc/rpc.proto
package org.memelabs.protobuf.rpc

import com.squareup.wire.FieldEncoding
import com.squareup.wire.Message
import com.squareup.wire.ProtoAdapter
import com.squareup.wire.ProtoReader
import com.squareup.wire.ProtoWriter
import com.squareup.wire.Syntax.PROTO_3
import kotlin.Any
import kotlin.AssertionError
import kotlin.Boolean
import kotlin.Deprecated
import kotlin.DeprecationLevel
import kotlin.Int
import kotlin.Long
import kotlin.Nothing
import kotlin.String
import kotlin.jvm.JvmField
import okio.ByteString

class Close(
  unknownFields: ByteString = ByteString.EMPTY
) : Message<Close, Nothing>(ADAPTER, unknownFields) {
  @Deprecated(
    message = "Shouldn't be used in Kotlin",
    level = DeprecationLevel.HIDDEN
  )
  override fun newBuilder(): Nothing = throw AssertionError()

  override fun equals(other: Any?): Boolean {
    if (other === this) return true
    if (other !is Close) return false
    if (unknownFields != other.unknownFields) return false
    return true
  }

  override fun hashCode(): Int = unknownFields.hashCode()

  override fun toString(): String = "Close{}"

  fun copy(unknownFields: ByteString = this.unknownFields): Close = Close(unknownFields)

  companion object {
    @JvmField
    val ADAPTER: ProtoAdapter<Close> = object : ProtoAdapter<Close>(
      FieldEncoding.LENGTH_DELIMITED, 
      Close::class, 
      "type.googleapis.com/strims.rpc.Close", 
      PROTO_3, 
      null
    ) {
      override fun encodedSize(value: Close): Int {
        var size = value.unknownFields.size
        return size
      }

      override fun encode(writer: ProtoWriter, value: Close) {
        writer.writeBytes(value.unknownFields)
      }

      override fun decode(reader: ProtoReader): Close {
        val unknownFields = reader.forEachTag(reader::readUnknownField)
        return Close(
          unknownFields = unknownFields
        )
      }

      override fun redact(value: Close): Close = value.copy(
        unknownFields = ByteString.EMPTY
      )
    }

    private const val serialVersionUID: Long = 0L
  }
}
