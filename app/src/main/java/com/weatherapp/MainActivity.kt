package com.weatherapp

import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import android.view.View
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.recyclerview.widget.LinearLayoutManager
import com.bumptech.glide.Glide
import com.weatherapp.databinding.ActivityMainBinding
import com.weatherapp.ui.ForecastAdapter
import com.weatherapp.ui.WeatherViewModel
import com.weatherapp.util.Constants
import com.weatherapp.util.Resource
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.CancellationTokenSource
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private val viewModel: WeatherViewModel by viewModels()
    private lateinit var forecastAdapter: ForecastAdapter
    private lateinit var fusedLocationClient: FusedLocationProviderClient

    private val locationPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted) {
            fetchCurrentLocation()
        } else {
            Toast.makeText(this, getString(R.string.location_permission_denied), Toast.LENGTH_SHORT).show()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        fusedLocationClient = LocationServices.getFusedLocationProviderClient(this)

        setupRecyclerView()
        setupSearch()
        setupButtons()
        observeViewModel()

        binding.swipeRefreshLayout.setOnRefreshListener {
            viewModel.refresh()
        }
    }

    private fun setupRecyclerView() {
        forecastAdapter = ForecastAdapter()
        binding.rvForecast.apply {
            adapter = forecastAdapter
            layoutManager = LinearLayoutManager(this@MainActivity)
            setHasFixedSize(true)
        }
    }

    private fun setupSearch() {
        binding.etSearch.setOnEditorActionListener { _, actionId, _ ->
            if (actionId == EditorInfo.IME_ACTION_SEARCH) {
                val city = binding.etSearch.text.toString().trim()
                if (city.isNotBlank()) {
                    viewModel.fetchWeatherByCity(city)
                    hideKeyboard()
                }
                true
            } else false
        }

        binding.btnSearch.setOnClickListener {
            val city = binding.etSearch.text.toString().trim()
            if (city.isNotBlank()) {
                viewModel.fetchWeatherByCity(city)
                hideKeyboard()
            } else {
                Toast.makeText(this, getString(R.string.enter_city_name), Toast.LENGTH_SHORT).show()
            }
        }
    }

    private fun setupButtons() {
        binding.btnLocation.setOnClickListener {
            requestLocationPermission()
        }

        binding.btnToggleUnit.setOnClickListener {
            viewModel.toggleUnit()
        }
    }

    private fun observeViewModel() {
        viewModel.currentWeather.observe(this) { resource ->
            when (resource) {
                is Resource.Loading -> {
                    binding.progressBar.visibility = View.VISIBLE
                    binding.layoutWeather.visibility = View.GONE
                    binding.tvError.visibility = View.GONE
                }
                is Resource.Success -> {
                    binding.progressBar.visibility = View.GONE
                    binding.swipeRefreshLayout.isRefreshing = false
                    binding.tvError.visibility = View.GONE
                    binding.layoutWeather.visibility = View.VISIBLE
                    displayWeather(resource.data)
                }
                is Resource.Error -> {
                    binding.progressBar.visibility = View.GONE
                    binding.swipeRefreshLayout.isRefreshing = false
                    binding.layoutWeather.visibility = View.GONE
                    binding.tvError.visibility = View.VISIBLE
                    binding.tvError.text = resource.message
                }
            }
        }

        viewModel.forecast.observe(this) { resource ->
            when (resource) {
                is Resource.Success -> {
                    forecastAdapter.submitList(resource.data)
                    binding.tvForecastTitle.visibility = View.VISIBLE
                    binding.rvForecast.visibility = View.VISIBLE
                }
                is Resource.Error -> {
                    binding.tvForecastTitle.visibility = View.GONE
                    binding.rvForecast.visibility = View.GONE
                }
                is Resource.Loading -> {
                    // already handled by current weather loading state
                }
            }
        }

        viewModel.unit.observe(this) { unit ->
            val label = if (unit == Constants.UNIT_METRIC) "°C" else "°F"
            binding.btnToggleUnit.text = label
        }
    }

    private fun displayWeather(data: com.weatherapp.data.model.WeatherResponse) {
        val country = data.sys.country?.let { ", $it" } ?: ""
        binding.tvCityName.text = "${data.name}$country"
        binding.tvTemperature.text = viewModel.formatTemp(data.main.temp)
        binding.tvFeelsLike.text = getString(R.string.feels_like, viewModel.formatTemp(data.main.feelsLike))
        binding.tvDescription.text = data.weather.firstOrNull()?.description?.replaceFirstChar { it.uppercase() } ?: ""
        binding.tvHumidity.text = getString(R.string.humidity_value, data.main.humidity)
        binding.tvWind.text = getString(R.string.wind_value, viewModel.formatWindSpeed(data.wind.speed))
        binding.tvPressure.text = getString(R.string.pressure_value, data.main.pressure)
        binding.tvVisibility.text = getString(R.string.visibility_value, (data.visibility ?: 0) / 1000)

        val sdf = SimpleDateFormat("EEE, MMM d · h:mm a", Locale.getDefault())
        binding.tvLastUpdated.text = getString(R.string.last_updated, sdf.format(Date(data.dt * 1000L)))

        val iconCode = data.weather.firstOrNull()?.icon ?: "01d"
        val iconUrl = "${Constants.ICON_URL}${iconCode}${Constants.ICON_SUFFIX}"
        Glide.with(this).load(iconUrl).into(binding.ivWeatherIcon)
    }

    private fun requestLocationPermission() {
        when {
            ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION)
                    == PackageManager.PERMISSION_GRANTED -> {
                fetchCurrentLocation()
            }
            else -> {
                locationPermissionLauncher.launch(Manifest.permission.ACCESS_FINE_LOCATION)
            }
        }
    }

    private fun fetchCurrentLocation() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION)
            != PackageManager.PERMISSION_GRANTED) return

        val cancellationToken = CancellationTokenSource()
        fusedLocationClient.getCurrentLocation(Priority.PRIORITY_HIGH_ACCURACY, cancellationToken.token)
            .addOnSuccessListener { location ->
                if (location != null) {
                    viewModel.fetchWeatherByCoords(location.latitude, location.longitude)
                } else {
                    Toast.makeText(this, getString(R.string.location_unavailable), Toast.LENGTH_SHORT).show()
                }
            }
            .addOnFailureListener {
                Toast.makeText(this, getString(R.string.location_error), Toast.LENGTH_SHORT).show()
            }
    }

    private fun hideKeyboard() {
        val imm = getSystemService(INPUT_METHOD_SERVICE) as InputMethodManager
        imm.hideSoftInputFromWindow(binding.root.windowToken, 0)
    }
}
