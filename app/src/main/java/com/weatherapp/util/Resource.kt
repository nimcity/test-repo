package com.weatherapp.util

/**
 * A generic wrapper class for handling API responses and UI states.
 */
sealed class Resource<out T> {

    data class Success<out T>(val data: T) : Resource<T>()

    data class Error(val message: String, val code: Int? = null) : Resource<Nothing>()

    object Loading : Resource<Nothing>()

    val isLoading get() = this is Loading
    val isSuccess get() = this is Success
    val isError get() = this is Error
}
